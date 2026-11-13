/**
 * KwaraCoop OS: Core Financial & Amortization Engine
 * Kwara State Ministry of Business, Innovation and Technology
 * 
 * Strict Double-Entry Ledger, Loan Amortization & Peer-Guarantor Qualification
 */

export interface Account {
  id: string;
  societyId: string;
  memberId?: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY';
  balance: number;
}

export interface Posting {
  accountId: string;
  debit: number;
  credit: number;
}

export interface JournalEntry {
  id: string;
  societyId: string;
  referenceNumber: string;
  narration: string;
  postings: Posting[];
  timestamp: Date;
}

export interface AmortizationScheduleRow {
  installmentNumber: number;
  dueDate: string;
  principalDue: number;
  interestDue: number;
  totalMonthlyEMI: number;
  remainingBalance: number;
}

/**
 * 1. DOUBLE-ENTRY FINANCIAL LEDGER ENGINE
 * Enforces fundamental accounting rule: Sum(Debits) MUST EQUAL Sum(Credits)
 */
export class DoubleEntryLedger {
  private accounts: Map<string, Account> = new Map();
  private journalHistory: JournalEntry[] = [];

  public registerAccount(account: Account): void {
    this.accounts.set(account.id, { ...account });
  }

  public getAccount(accountId: string): Account {
    const acc = this.accounts.get(accountId);
    if (!acc) throw new Error(`Account ${accountId} does not exist.`);
    return acc;
  }

  /**
   * Posts an immutable, balanced transaction into the ledger
   */
  public postTransaction(
    societyId: string,
    referenceNumber: string,
    narration: string,
    postings: Posting[]
  ): JournalEntry {
    if (postings.length < 2) {
      throw new Error('A double-entry posting requires at least one debit and one credit.');
    }

    let totalDebit = 0;
    let totalCredit = 0;

    for (const p of postings) {
      if (p.debit < 0 || p.credit < 0) {
        throw new Error('Debit and credit amounts must be non-negative.');
      }
      if (p.debit > 0 && p.credit > 0) {
        throw new Error('A single posting leg cannot simultaneously have debit and credit amounts.');
      }
      totalDebit += p.debit;
      totalCredit += p.credit;
    }

    // Floating-point safety tolerance (1 kobo = 0.01 NGN)
    if (Math.abs(totalDebit - totalCredit) > 0.001) {
      throw new Error(
        `Ledger Unbalanced! Total Debits (₦${totalDebit.toFixed(2)}) must equal Total Credits (₦${totalCredit.toFixed(2)}).`
      );
    }

    // Apply adjustments
    for (const p of postings) {
      const acc = this.getAccount(p.accountId);
      if (acc.type === 'ASSET') {
        acc.balance += p.debit - p.credit;
      } else {
        // LIABILITIES and EQUITY increase on Credit, decrease on Debit
        acc.balance += p.credit - p.debit;
      }
      this.accounts.set(acc.id, acc);
    }

    const entry: JournalEntry = {
      id: `JRN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      societyId,
      referenceNumber,
      narration,
      postings,
      timestamp: new Date()
    };

    this.journalHistory.push(entry);
    return entry;
  }
}

/**
 * 2. INTELLIGENT LOAN & AMORTIZATION ENGINE
 */
export class LoanEngine {
  /**
   * Evaluates maximum borrowing capacity based on accumulated savings & share capital
   * Default KwaraCoop rule: Up to 200% of collateral savings
   */
  public static calculateBorrowingCapacity(
    thriftBalance: number,
    shareCapital: number,
    activeOutstandingLoans: number,
    multiplier: number = 2.0
  ): { maxAllowed: number; currentCollateralBase: number; availableLimit: number } {
    const collateralBase = thriftBalance + shareCapital;
    const maxAllowed = collateralBase * multiplier;
    const availableLimit = Math.max(0, maxAllowed - activeOutstandingLoans);

    return {
      maxAllowed,
      currentCollateralBase: collateralBase,
      availableLimit
    };
  }

  /**
   * Generates a monthly amortization schedule with equal monthly installments (EMI)
   */
  public static generateAmortizationSchedule(
    principal: number,
    annualInterestRatePct: number,
    tenureMonths: number,
    startDate: Date = new Date(),
    interestType: 'FLAT' | 'REDUCING_BALANCE' = 'FLAT'
  ): {
    totalInterest: number;
    totalRepayable: number;
    monthlyInstallment: number;
    schedule: AmortizationScheduleRow[];
  } {
    const schedule: AmortizationScheduleRow[] = [];

    if (interestType === 'FLAT') {
      const totalInterest = principal * (annualInterestRatePct / 100) * (tenureMonths / 12);
      const totalRepayable = principal + totalInterest;
      const monthlyInstallment = totalRepayable / tenureMonths;
      const monthlyPrincipal = principal / tenureMonths;
      const monthlyInterest = totalInterest / tenureMonths;

      let remaining = principal;

      for (let i = 1; i <= tenureMonths; i++) {
        remaining -= monthlyPrincipal;
        const due = new Date(startDate);
        due.setMonth(due.getMonth() + i);

        schedule.push({
          installmentNumber: i,
          dueDate: due.toISOString().split('T')[0],
          principalDue: Number(monthlyPrincipal.toFixed(2)),
          interestDue: Number(monthlyInterest.toFixed(2)),
          totalMonthlyEMI: Number(monthlyInstallment.toFixed(2)),
          remainingBalance: Math.max(0, Number(remaining.toFixed(2)))
        });
      }

      return {
        totalInterest: Number(totalInterest.toFixed(2)),
        totalRepayable: Number(totalRepayable.toFixed(2)),
        monthlyInstallment: Number(monthlyInstallment.toFixed(2)),
        schedule
      };
    } else {
      // Reducing balance calculation
      const monthlyRate = annualInterestRatePct / 100 / 12;
      const emi =
        (principal * monthlyRate * Math.pow(1 + monthlyRate, tenureMonths)) /
        (Math.pow(1 + monthlyRate, tenureMonths) - 1);

      let balance = principal;
      let totalInterest = 0;

      for (let i = 1; i <= tenureMonths; i++) {
        const interestDue = balance * monthlyRate;
        const principalDue = emi - interestDue;
        balance -= principalDue;
        totalInterest += interestDue;

        const due = new Date(startDate);
        due.setMonth(due.getMonth() + i);

        schedule.push({
          installmentNumber: i,
          dueDate: due.toISOString().split('T')[0],
          principalDue: Number(principalDue.toFixed(2)),
          interestDue: Number(interestDue.toFixed(2)),
          totalMonthlyEMI: Number(emi.toFixed(2)),
          remainingBalance: Math.max(0, Number(balance.toFixed(2)))
        });
      }

      return {
        totalInterest: Number(totalInterest.toFixed(2)),
        totalRepayable: Number((principal + totalInterest).toFixed(2)),
        monthlyInstallment: Number(emi.toFixed(2)),
        schedule
      };
    }
  }

  /**
   * Validates whether nominated guarantors have sufficient unencumbered savings
   */
  public static validateGuarantors(
    requestedLoanAmount: number,
    guarantors: Array<{
      memberId: string;
      name: string;
      thriftSavings: number;
      alreadyGuaranteedAmount: number;
    }>
  ): { isApproved: boolean; reason?: string; allocatedEncumbrances: Record<string, number> } {
    if (guarantors.length < 2) {
      return { isApproved: false, reason: 'At least 2 peer guarantors are required by Kwara State guidelines.', allocatedEncumbrances: {} };
    }

    const halfRequired = requestedLoanAmount / 2;
    const allocated: Record<string, number> = {};

    for (const g of guarantors) {
      const freeCollateral = g.thriftSavings - g.alreadyGuaranteedAmount;
      if (freeCollateral < halfRequired) {
        return {
          isApproved: false,
          reason: `Guarantor ${g.name} has only ₦${freeCollateral.toLocaleString()} unencumbered savings, which is below the ₦${halfRequired.toLocaleString()} required.`,
          allocatedEncumbrances: {}
        };
      }
      allocated[g.memberId] = halfRequired;
    }

    return { isApproved: true, allocatedEncumbrances: allocated };
  }
}
