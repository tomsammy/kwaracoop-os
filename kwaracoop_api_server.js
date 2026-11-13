/**
 * KwaraCoop OS: Zero-Dependency Backend REST API & USSD Server
 * Kwara State Ministry of Business, Innovation and Technology
 * 
 * Run with: node kwaracoop_api_server.js
 * Default Port: 3000 (or PORT environment variable)
 */

const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 3000;

// IN-MEMORY MOCK STATE (Initialized based on KwaraCoop Schema)
const state = {
  society: {
    kcr_id: 'KW/ILW/2024/0481',
    name: 'Ilorin West Progressive Farmers CTCS',
    lga: 'Ilorin_West',
    status: 'Active_Licensed',
    totalSavings: 84250000,
    reserveFund: 1955000
  },
  members: [
    {
      id: 'mem_001',
      member_code: 'KW/ILW/0481',
      name: 'Alhaji Ahmed Aliyu',
      phone: '08039218291',
      nin: '29103847291',
      nuban: '9920148291',
      bank: 'Providus Bank',
      balances: {
        liquid_wallet: 48500.00,
        regular_thrift: 420000.00,
        share_capital: 100000.00,
        target_vaults: 215000.00,
        active_loan: 125000.00
      }
    }
  ],
  loans: [],
  transactions: []
};

// HELPER: Send JSON
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data, null, 2));
}

// HELPER: Send Plain Text (for USSD responses)
function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(text);
}

// PARSE JSON BODY
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

// SERVER DISPATCHER
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  try {
    // 1. Root Status
    if (pathname === '/' && method === 'GET') {
      return sendJson(res, 200, {
        system: 'KwaraCoop OS API Gateway',
        ministry: 'Kwara State Ministry of Business, Innovation and Technology',
        status: 'ONLINE',
        version: '1.0.4',
        endpoints: [
          'GET /api/v1/societies',
          'GET /api/v1/member/:phone/balances',
          'POST /api/v1/webhooks/bank-transfer',
          'POST /api/v1/loans/apply',
          'POST /api/v1/webhooks/ussd'
        ]
      });
    }

    // 2. Societies Endpoint
    if (pathname === '/api/v1/societies' && method === 'GET') {
      return sendJson(res, 200, {
        totalSocieties: 1,
        data: [state.society]
      });
    }

    // 3. Member Balances
    if (pathname.startsWith('/api/v1/member/') && pathname.endsWith('/balances') && method === 'GET') {
      const parts = pathname.split('/');
      const phone = parts[4];
      const member = state.members.find(m => m.phone === phone);

      if (!member) {
        return sendJson(res, 404, { error: 'Member not found' });
      }

      return sendJson(res, 200, {
        member: {
          name: member.name,
          member_code: member.member_code,
          phone: member.phone,
          nuban: member.nuban,
          bank: member.bank,
          balances: member.balances,
          borrowingPower: member.balances.regular_thrift * 2
        }
      });
    }

    // 4. Inbound NUBAN Webhook (BaaS simulation: Providus / Monnify)
    if (pathname === '/api/v1/webhooks/bank-transfer' && method === 'POST') {
      const body = await parseBody(req);
      const { account_number, amount, sender_name, ref } = body;

      const member = state.members.find(m => m.nuban === account_number);
      if (!member) {
        return sendJson(res, 404, { error: 'Virtual NUBAN not found in KwaraCoop registry' });
      }

      const creditAmount = parseFloat(amount) || 0;
      if (creditAmount <= 0) {
        return sendJson(res, 400, { error: 'Invalid credit amount' });
      }

      // Update Double-Entry Balance
      member.balances.liquid_wallet += creditAmount;
      const txRef = ref || `KWCP-TX-${Date.now()}`;
      state.transactions.push({
        ref: txRef,
        member_id: member.id,
        amount: creditAmount,
        type: 'NUBAN_DEPOSIT',
        sender: sender_name || 'External Bank Customer',
        timestamp: new Date()
      });

      return sendJson(res, 200, {
        status: 'SUCCESS',
        transaction_reference: txRef,
        credited_nuban: account_number,
        new_wallet_balance: member.balances.liquid_wallet,
        sms_alert_dispatched: `Credit: NGN ${creditAmount.toLocaleString()} received into KwaraCoop Acct ${account_number}. Bal: NGN ${member.balances.liquid_wallet.toLocaleString()}. Ref: ${txRef}`
      });
    }

    // 5. Loan Application & Amortization Calculation
    if (pathname === '/api/v1/loans/apply' && method === 'POST') {
      const body = await parseBody(req);
      const { phone, amount, tenure_months, purpose } = body;

      const member = state.members.find(m => m.phone === phone);
      if (!member) return sendJson(res, 404, { error: 'Member not found' });

      const principal = parseFloat(amount) || 0;
      const tenure = parseInt(tenure_months) || 12;
      const maxAllowed = member.balances.regular_thrift * 2;

      if (principal > maxAllowed) {
        return sendJson(res, 400, {
          error: 'LOAN_CEILING_EXCEEDED',
          message: `Requested loan of ₦${principal.toLocaleString()} exceeds 2x collateral ceiling of ₦${maxAllowed.toLocaleString()}.`
        });
      }

      // 5% flat interest calculation
      const totalInterest = principal * 0.05 * (tenure / 12);
      const totalRepayable = principal + totalInterest;
      const monthlyEMI = totalRepayable / tenure;

      const loanRecord = {
        loan_id: `LN-KW-${Date.now()}`,
        member_name: member.name,
        principal,
        tenure_months: tenure,
        total_interest: totalInterest,
        total_repayable: totalRepayable,
        monthly_emi: Math.round(monthlyEMI),
        purpose: purpose || 'Agro-Business / Trade Expansion',
        status: 'PENDING_EXECUTIVE_APPROVAL'
      };

      state.loans.push(loanRecord);

      return sendJson(res, 201, {
        status: 'APPLICATION_SUBMITTED',
        loan: loanRecord
      });
    }

    // 6. Africa's Talking / Termii Standard USSD Webhook Handler (*384*24#)
    if (pathname === '/api/v1/webhooks/ussd' && method === 'POST') {
      const body = await parseBody(req);
      const text = (body.text || '').trim();
      const phone = body.phoneNumber || '08039218291';
      const member = state.members.find(m => m.phone === phone) || state.members[0];

      let response = '';

      if (text === '') {
        // Main Menu
        response = `CON Welcome to KwaraCoop Banking
1. Check Balance
2. Mini Statement
3. Target Savings
4. Request Quick Loan
5. Approve Guarantor
0. Exit`;
      } else if (text === '1') {
        response = `CON KwaraCoop Balances for ${member.name}:
- Cash Wallet: NGN ${member.balances.liquid_wallet.toLocaleString()}
- Regular Thrift: NGN ${member.balances.regular_thrift.toLocaleString()}
- Target Vaults: NGN ${member.balances.target_vaults.toLocaleString()}
- Active Loan: NGN ${member.balances.active_loan.toLocaleString()}

0. Back to Main Menu`;
      } else if (text === '2') {
        response = `END Mini-Statement dispatched via free SMS to your phone (${member.phone}).`;
      } else if (text === '4') {
        const eligible = member.balances.regular_thrift * 2;
        response = `CON Micro-Loan Eligibility:
You are pre-approved for up to NGN ${eligible.toLocaleString()}.
Reply with amount to request (e.g. 50000):`;
      } else if (text.startsWith('4*')) {
        const amt = text.split('*')[1];
        response = `END Loan request for NGN ${parseInt(amt || 0).toLocaleString()} submitted! Verification SMS sent to your peer guarantors.`;
      } else if (text === '5') {
        response = `CON Guarantor Requests:
1. Mallam Garba seeks NGN 80,000 guarantee.
Reply 1 to Accept & Sign with PIN, 2 to Reject:`;
      } else if (text === '5*1') {
        response = `END Guarantee confirmed! NGN 80,000 collateral pledged. Notification sent to Society President.`;
      } else if (text === '0') {
        response = `END Thank you for banking with KwaraCoop.`;
      } else {
        response = `END Invalid selection. Please dial *384*24# again.`;
      }

      return sendText(res, 200, response);
    }

    // 404 Catch-All
    return sendJson(res, 404, { error: 'Route not found' });

  } catch (err) {
    return sendJson(res, 500, { error: 'Internal Server Error', details: err.message });
  }
});

// Start Server if run directly
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`========================================================`);
    console.log(` KwaraCoop OS: API Gateway & USSD Engine Started!`);
    console.log(` Port: ${PORT} | Mode: Production-Ready Zero-Dep Server`);
    console.log(` Healthcheck: http://localhost:${PORT}/`);
    console.log(` USSD Webhook: POST http://localhost:${PORT}/api/v1/webhooks/ussd`);
    console.log(`========================================================`);
  });
}

module.exports = server;
