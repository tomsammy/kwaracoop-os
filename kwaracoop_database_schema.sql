-- ============================================================================
-- KwaraCoop OS: Core Database Schema (PostgreSQL 15+)
-- Kwara State Ministry of Business, Innovation & Technology
-- Multi-Tenant Core Banking & Cooperative Regulatory Ledger
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. ENUMS & DOMAINS
-- ----------------------------------------------------------------------------
CREATE TYPE lga_enum AS ENUM (
    'Asa', 'Baruten', 'Edu', 'Ekiti', 'Ifelodun', 'Ilorin_East', 
    'Ilorin_South', 'Ilorin_West', 'Irepodun', 'Isin', 'Kaiama', 
    'Moro', 'Offa', 'Oke_Ero', 'Oyun', 'Patigi'
);

CREATE TYPE society_type_enum AS ENUM (
    'CTCS_Thrift_Credit', 'Farmers_Agricultural', 'Artisans_Market_Traders', 
    'Multipurpose_CMS', 'Transport_Workers'
);

CREATE TYPE society_status_enum AS ENUM (
    'Pending_Registration', 'Active_Licensed', 'Suspended', 'Liquidation'
);

CREATE TYPE member_status_enum AS ENUM (
    'Pending_KYC', 'Active', 'Suspended', 'Deceased', 'Exited'
);

CREATE TYPE account_type_enum AS ENUM (
    'Liquid_Wallet', 'Mandatory_Thrift', 'Share_Capital', 
    'Target_Savings', 'Loan_Receivable'
);

CREATE TYPE loan_status_enum AS ENUM (
    'Draft', 'Pending_Guarantors', 'Pending_Approval', 'Approved', 
    'Disbursed', 'In_Repayment', 'Defaulted', 'Liquidated'
);

CREATE TYPE transaction_channel_enum AS ENUM (
    'Bank_Transfer_NUBAN', 'USSD_Offline', 'Web_Portal', 
    'Mobile_App', 'Field_Collector_POS', 'Payroll_Deduction'
);

CREATE TYPE notification_channel_enum AS ENUM (
    'SMS', 'Push', 'WhatsApp', 'Email'
);

-- ----------------------------------------------------------------------------
-- 2. REGULATORY & SOCIETY LEVEL (TENANCY)
-- ----------------------------------------------------------------------------

-- Cooperative Societies registered under Kwara State Ministry
CREATE TABLE societies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kcr_id VARCHAR(32) UNIQUE NOT NULL, -- Kwara Cooperative Registration ID (e.g. KW/ILW/2024/0481)
    name VARCHAR(255) NOT NULL,
    society_type society_type_enum NOT NULL,
    lga lga_enum NOT NULL,
    senatorial_district VARCHAR(32) NOT NULL, -- Kwara Central, Kwara South, Kwara North
    registration_date DATE NOT NULL DEFAULT CURRENT_DATE,
    license_expiry_date DATE NOT NULL,
    status society_status_enum DEFAULT 'Active_Licensed',
    kwirs_tax_id VARCHAR(64),
    physical_address TEXT,
    contact_email VARCHAR(255),
    contact_phone VARCHAR(32),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 3. MEMBERS & IDENTITY (NIN / BVN VERIFIED)
-- ----------------------------------------------------------------------------

CREATE TABLE members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    society_id UUID NOT NULL REFERENCES societies(id) ON DELETE RESTRICT,
    member_code VARCHAR(32) NOT NULL, -- e.g. MEM-00481
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    other_names VARCHAR(100),
    phone_number VARCHAR(20) NOT NULL,
    email VARCHAR(255),
    nin CHAR(11) UNIQUE NOT NULL, -- National Identity Number
    bvn CHAR(11),
    date_of_birth DATE NOT NULL,
    gender VARCHAR(10),
    lga_of_residence lga_enum NOT NULL,
    residential_address TEXT NOT NULL,
    next_of_kin_name VARCHAR(255) NOT NULL,
    next_of_kin_phone VARCHAR(32) NOT NULL,
    next_of_kin_relationship VARCHAR(50) NOT NULL,
    status member_status_enum DEFAULT 'Active',
    pin_hash VARCHAR(255) NOT NULL, -- Bcrypt hash for 4-digit transaction PIN
    monthly_thrift_pledge NUMERIC(15, 2) NOT NULL DEFAULT 5000.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_society_member_code UNIQUE (society_id, member_code)
);

CREATE INDEX idx_members_phone ON members(phone_number);
CREATE INDEX idx_members_nin ON members(nin);
CREATE INDEX idx_members_society ON members(society_id);

-- Dedicated NUBAN Virtual Account mapped to each member
CREATE TABLE member_virtual_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID UNIQUE NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    nuban_account_number CHAR(10) UNIQUE NOT NULL,
    bank_name VARCHAR(100) NOT NULL DEFAULT 'Providus Bank',
    bank_code VARCHAR(10) NOT NULL DEFAULT '101',
    account_name VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 4. DOUBLE-ENTRY CORE FINANCIAL LEDGER
-- ----------------------------------------------------------------------------

-- Financial Accounts (Assets, Liabilities, Equity)
CREATE TABLE ledger_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    society_id UUID NOT NULL REFERENCES societies(id) ON DELETE RESTRICT,
    member_id UUID REFERENCES members(id) ON DELETE RESTRICT, -- NULL for society-wide control accounts
    account_number VARCHAR(32) NOT NULL,
    account_name VARCHAR(150) NOT NULL,
    account_type account_type_enum NOT NULL,
    currency CHAR(3) DEFAULT 'NGN',
    current_balance NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_society_account_number UNIQUE (society_id, account_number)
);

CREATE INDEX idx_ledger_member_account ON ledger_accounts(member_id, account_type);

-- Journal Entries (Balanced double-entry container)
CREATE TABLE journal_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    society_id UUID NOT NULL REFERENCES societies(id),
    reference_number VARCHAR(64) UNIQUE NOT NULL, -- Unique idempotency key
    narration TEXT NOT NULL,
    channel transaction_channel_enum NOT NULL,
    initiated_by_member_id UUID REFERENCES members(id),
    posted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ledger Postings (Every journal entry must have matching debits and credits)
CREATE TABLE ledger_postings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
    debit_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    credit_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    balance_after NUMERIC(15, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT chk_debit_or_credit CHECK (
        (debit_amount > 0 AND credit_amount = 0) OR 
        (credit_amount > 0 AND debit_amount = 0)
    )
);

CREATE INDEX idx_postings_account ON ledger_postings(account_id);
CREATE INDEX idx_postings_journal ON ledger_postings(journal_entry_id);

-- ----------------------------------------------------------------------------
-- 5. SPECIAL & TARGET SAVINGS VAULTS
-- ----------------------------------------------------------------------------

CREATE TABLE target_savings_vaults (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES ledger_accounts(id),
    vault_name VARCHAR(150) NOT NULL, -- e.g. "Ileya Ram 2027", "Children School Fees"
    target_amount NUMERIC(15, 2) NOT NULL,
    current_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    interest_rate_pa NUMERIC(5, 2) NOT NULL DEFAULT 8.00,
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    maturity_date DATE NOT NULL,
    is_locked BOOLEAN DEFAULT TRUE,
    early_liquidation_penalty_pct NUMERIC(5, 2) DEFAULT 2.50,
    status VARCHAR(32) DEFAULT 'Active', -- Active, Matured, Liquidated
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 6. LOAN ORIGINATION, GUARANTORS & AMORTIZATION
-- ----------------------------------------------------------------------------

CREATE TABLE loan_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    society_id UUID NOT NULL REFERENCES societies(id),
    product_name VARCHAR(100) NOT NULL, -- e.g. "Agricultural Soft Loan", "Emergency Facility"
    max_multiplier_of_savings NUMERIC(4, 2) NOT NULL DEFAULT 2.00, -- e.g. 2x savings
    interest_rate_pct NUMERIC(5, 2) NOT NULL, -- e.g. 5.00%
    interest_type VARCHAR(20) DEFAULT 'Flat', -- Flat or Reducing_Balance
    max_tenure_months INT NOT NULL DEFAULT 12,
    guarantors_required INT NOT NULL DEFAULT 2,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE loan_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_number VARCHAR(64) UNIQUE NOT NULL,
    society_id UUID NOT NULL REFERENCES societies(id),
    member_id UUID NOT NULL REFERENCES members(id),
    loan_product_id UUID NOT NULL REFERENCES loan_products(id),
    principal_amount NUMERIC(15, 2) NOT NULL,
    tenure_months INT NOT NULL,
    interest_rate_pct NUMERIC(5, 2) NOT NULL,
    total_interest NUMERIC(15, 2) NOT NULL,
    total_repayable NUMERIC(15, 2) NOT NULL,
    monthly_installment NUMERIC(15, 2) NOT NULL,
    outstanding_balance NUMERIC(15, 2) NOT NULL,
    purpose TEXT NOT NULL,
    status loan_status_enum DEFAULT 'Pending_Guarantors',
    approved_by_executive_id UUID,
    approved_at TIMESTAMP WITH TIME ZONE,
    disbursed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Peer Guarantor Endorsements
CREATE TABLE loan_guarantors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_application_id UUID NOT NULL REFERENCES loan_applications(id) ON DELETE CASCADE,
    guarantor_member_id UUID NOT NULL REFERENCES members(id),
    amount_guaranteed NUMERIC(15, 2) NOT NULL,
    collateral_encumbered_amount NUMERIC(15, 2) NOT NULL,
    status VARCHAR(32) DEFAULT 'Pending', -- Pending, Approved, Rejected, Released
    digital_signature_hash VARCHAR(255),
    responded_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_loan_guarantor UNIQUE (loan_application_id, guarantor_member_id)
);

-- Amortization Schedule (Repayment Trackers)
CREATE TABLE loan_repayment_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_application_id UUID NOT NULL REFERENCES loan_applications(id) ON DELETE CASCADE,
    installment_number INT NOT NULL,
    due_date DATE NOT NULL,
    principal_due NUMERIC(15, 2) NOT NULL,
    interest_due NUMERIC(15, 2) NOT NULL,
    total_due NUMERIC(15, 2) NOT NULL,
    amount_paid NUMERIC(15, 2) DEFAULT 0.00,
    is_paid BOOLEAN DEFAULT FALSE,
    paid_at TIMESTAMP WITH TIME ZONE,
    payment_channel transaction_channel_enum
);

-- ----------------------------------------------------------------------------
-- 7. MULTI-CHANNEL ALERTS & AUDIT TRAIL
-- ----------------------------------------------------------------------------

CREATE TABLE notification_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    channel notification_channel_enum NOT NULL,
    recipient_destination VARCHAR(255) NOT NULL, -- Phone number or email
    message_content TEXT NOT NULL,
    delivery_status VARCHAR(32) DEFAULT 'Sent',
    gateway_reference VARCHAR(128),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Regulatory Audit Logs for Ministry Oversight
CREATE TABLE ministry_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    society_id UUID REFERENCES societies(id),
    actor_id UUID,
    actor_role VARCHAR(64) NOT NULL, -- State_Auditor, Society_President, System_Cron
    action_type VARCHAR(100) NOT NULL,
    ip_address VARCHAR(45),
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 8. ROW-LEVEL SECURITY (RLS) POLICIES FOR TENANCY
-- ----------------------------------------------------------------------------

ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_applications ENABLE ROW LEVEL SECURITY;

-- Sample policy: Society Admins can only view and manage their own society's records
-- Ministry inspectors have elevated bypass roles defined in application context.
CREATE POLICY society_isolation_members ON members
    FOR ALL
    USING (society_id = current_setting('app.current_society_id')::UUID);

CREATE POLICY society_isolation_accounts ON ledger_accounts
    FOR ALL
    USING (society_id = current_setting('app.current_society_id')::UUID);
