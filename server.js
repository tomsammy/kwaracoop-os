/**
 * KwaraCoop OS: Unified Web Application & Backend API Server
 * Serves both the interactive frontends and the live Core Banking API & USSD engine.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const BASE_DIR = __dirname;

// IN-MEMORY COOPERATIVE DATABASE (Synced with PostgreSQL Schema)
const dbState = {
  society: {
    kcr_id: 'KW/ILW/2024/0481',
    name: 'Ilorin West Progressive Farmers CTCS',
    lga: 'Ilorin_West',
    status: 'Active_Licensed',
    totalSavings: 84250000,
    activeLoanPortfolio: 38100000,
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

// MIME Types Map
const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.sql': 'text/plain; charset=UTF-8',
  '.md': 'text/markdown; charset=UTF-8'
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=UTF-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data, null, 2));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=UTF-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(text);
}

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

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  let pathname = parsedUrl.pathname;
  const method = req.method;

  // Handle CORS
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  // --------------------------------------------------------------------------
  // 1. API ROUTES (/api/v1/...)
  // --------------------------------------------------------------------------

  // System Status
  if (pathname === '/api/v1/health' && method === 'GET') {
    return sendJson(res, 200, {
      status: 'ONLINE',
      system: 'KwaraCoop OS API Gateway',
      ministry: 'Kwara State Ministry of Business, Innovation and Technology',
      activeMembers: dbState.members.length,
      timestamp: new Date().toISOString()
    });
  }

  // Societies Directory
  if (pathname === '/api/v1/societies' && method === 'GET') {
    return sendJson(res, 200, {
      total: 1,
      data: [dbState.society]
    });
  }

  // Member Balances
  if (pathname.startsWith('/api/v1/member/') && pathname.endsWith('/balances') && method === 'GET') {
    const parts = pathname.split('/');
    const phone = parts[4];
    const member = dbState.members.find(m => m.phone === phone);

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

  // Inbound NUBAN Webhook (Providus / Monnify Pay-In Simulation)
  if (pathname === '/api/v1/webhooks/bank-transfer' && method === 'POST') {
    const body = await parseBody(req);
    const { account_number, amount, sender_name, ref } = body;

    const member = dbState.members.find(m => m.nuban === account_number);
    if (!member) {
      return sendJson(res, 404, { error: 'Virtual NUBAN not found' });
    }

    const creditAmount = parseFloat(amount) || 0;
    if (creditAmount <= 0) {
      return sendJson(res, 400, { error: 'Invalid credit amount' });
    }

    member.balances.liquid_wallet += creditAmount;
    const txRef = ref || `NIP-KW-${Date.now()}`;
    dbState.transactions.push({
      ref: txRef,
      member: member.name,
      amount: creditAmount,
      type: 'NUBAN_DEPOSIT',
      sender: sender_name || 'Bank Customer',
      timestamp: new Date()
    });

    return sendJson(res, 200, {
      status: 'SUCCESS',
      transaction_reference: txRef,
      credited_nuban: account_number,
      new_wallet_balance: member.balances.liquid_wallet,
      sms_dispatched: `Credit: NGN ${creditAmount.toLocaleString()} received into KwaraCoop Acct ${account_number}. Bal: NGN ${member.balances.liquid_wallet.toLocaleString()}. Ref: ${txRef}`
    });
  }

  // Loan Application API
  if (pathname === '/api/v1/loans/apply' && method === 'POST') {
    const body = await parseBody(req);
    const { phone, amount, tenure_months, purpose } = body;

    const member = dbState.members.find(m => m.phone === phone);
    if (!member) return sendJson(res, 404, { error: 'Member not found' });

    const principal = parseFloat(amount) || 0;
    const tenure = parseInt(tenure_months) || 12;
    const maxAllowed = member.balances.regular_thrift * 2;

    if (principal > maxAllowed) {
      return sendJson(res, 400, {
        error: 'LIMIT_EXCEEDED',
        message: `Requested loan of ₦${principal.toLocaleString()} exceeds maximum borrowing power of ₦${maxAllowed.toLocaleString()}.`
      });
    }

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
      purpose: purpose || 'Agro-Inputs / Business',
      status: 'PENDING_EXECUTIVE_APPROVAL'
    };

    dbState.loans.push(loanRecord);

    return sendJson(res, 201, {
      status: 'APPLICATION_SUBMITTED',
      loan: loanRecord
    });
  }

  // USSD Gateway Webhook (*384*24#)
  if (pathname === '/api/v1/webhooks/ussd' && method === 'POST') {
    const body = await parseBody(req);
    const text = (body.text || '').trim();
    const phone = body.phoneNumber || '08039218291';
    const member = dbState.members.find(m => m.phone === phone) || dbState.members[0];

    let response = '';
    if (text === '') {
      response = `CON Welcome to KwaraCoop Banking
1. Check Balance
2. Mini Statement
3. Target Savings
4. Apply Micro-Loan
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
      response = `END Mini-Statement dispatched via free SMS to ${member.phone}.`;
    } else if (text === '4') {
      const limit = member.balances.regular_thrift * 2;
      response = `CON Micro-Loan Eligibility:
Pre-approved limit: NGN ${limit.toLocaleString()}
Reply with amount to apply (e.g. 50000):`;
    } else if (text.startsWith('4*')) {
      const amt = text.split('*')[1];
      response = `END Loan application for NGN ${parseInt(amt || 0).toLocaleString()} received! Peer guarantors notified via SMS.`;
    } else if (text === '5') {
      response = `CON Guarantor Requests:
1. Mallam Garba seeks NGN 80,000 guarantee.
Reply 1 to Accept with PIN, 2 to Reject:`;
    } else if (text === '5*1') {
      response = `END Guarantee confirmed! NGN 80,000 collateral pledged.`;
    } else {
      response = `END Session ended. Thank you for using KwaraCoop.`;
    }

    return sendText(res, 200, response);
  }

  // --------------------------------------------------------------------------
  // 2. STATIC FILE ROUTING (Interactive Frontends)
  // --------------------------------------------------------------------------

  // Friendly Route Aliases
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  if (pathname === '/member') pathname = '/member_banking_dashboard.html';
  if (pathname === '/society') pathname = '/society_admin_portal.html';
  if (pathname === '/ministry') pathname = '/ministry_portal.html';
  if (pathname === '/pos' || pathname === '/ussd') pathname = '/field_agent_pos.html';

  const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(BASE_DIR, safePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      return sendJson(res, 404, { error: 'File Not Found', requested: pathname });
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`========================================================`);
    console.log(` KwaraCoop OS: Unified Platform Server Running!`);
    console.log(` Port: ${PORT}`);
    console.log(` Master Launchpad:      http://localhost:${PORT}/`);
    console.log(` Member Banking App:    http://localhost:${PORT}/member`);
    console.log(` Society Admin Portal:  http://localhost:${PORT}/society`);
    console.log(` Ministry Dashboard:    http://localhost:${PORT}/ministry`);
    console.log(` Field POS & USSD:      http://localhost:${PORT}/pos`);
    console.log(` API Healthcheck:       http://localhost:${PORT}/api/v1/health`);
    console.log(`========================================================`);
  });
}

module.exports = server;
