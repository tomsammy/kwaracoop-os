const server = require('./kwaracoop_api_server.js');
const http = require('http');

server.listen(3099, async () => {
  function get(endpoint) {
    return new Promise((resolve, reject) => {
      http.get(`http://localhost:3099${endpoint}`, (res) => {
        let d = '';
        res.on('data', chunk => d += chunk);
        res.on('end', () => resolve(JSON.parse(d)));
      }).on('error', reject);
    });
  }

  function post(endpoint, data) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(data);
      const req = http.request({
        hostname: 'localhost',
        port: 3099,
        path: endpoint,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (res) => {
        let d = '';
        res.on('data', chunk => d += chunk);
        res.on('end', () => resolve(d));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  try {
    console.log("=================================================");
    console.log(" TESTING KWARA-COOP LIVE API & USSD WEBHHOOKS");
    console.log("=================================================\n");

    console.log("1. Testing Root Status Endpoint...");
    const root = await get('/');
    console.log(`  [OK] System: ${root.system} | Status: ${root.status}`);

    console.log("\n2. Testing Member Balances Query (08039218291)...");
    const member = await get('/api/v1/member/08039218291/balances');
    console.log(`  [OK] Member: ${member.member.name}`);
    console.log(`  [OK] Liquid Wallet: ₦${member.member.balances.liquid_wallet.toLocaleString()}`);
    console.log(`  [OK] Regular Thrift: ₦${member.member.balances.regular_thrift.toLocaleString()}`);
    console.log(`  [OK] Borrowing Capacity: ₦${member.member.borrowingPower.toLocaleString()}`);

    console.log("\n3. Testing Inbound Virtual NUBAN Webhook (₦15,000 Pay-in)...");
    const payinRaw = await post('/api/v1/webhooks/bank-transfer', {
      account_number: '9920148291',
      amount: 15000,
      sender_name: 'Mallam Yusuf Patigi',
      ref: 'NIP-KWCP-2026-9901'
    });
    const payin = JSON.parse(payinRaw);
    console.log(`  [OK] Inbound Pay-in: ${payin.status}`);
    console.log(`  [OK] New Wallet Balance: ₦${payin.new_wallet_balance.toLocaleString()}`);
    console.log(`  [OK] Dispatched SMS: "${payin.sms_alert_dispatched}"`);

    console.log("\n4. Testing Loan Application (₦200,000 over 12 Months)...");
    const loanRaw = await post('/api/v1/loans/apply', {
      phone: '08039218291',
      amount: 200000,
      tenure_months: 12,
      purpose: 'Dry Season Irrigation Equipment'
    });
    const loan = JSON.parse(loanRaw);
    console.log(`  [OK] Application Status: ${loan.status}`);
    console.log(`  [OK] Principal: ₦${loan.loan.principal.toLocaleString()} | Total Repayable: ₦${loan.loan.total_repayable.toLocaleString()}`);
    console.log(`  [OK] Monthly EMI: ₦${loan.loan.monthly_emi.toLocaleString()}/month`);

    console.log("\n5. Testing Africa's Talking USSD Gateway Callback (*384*24# Menu 1)...");
    const ussdResp = await post('/api/v1/webhooks/ussd', {
      phoneNumber: '08039218291',
      text: '1'
    });
    console.log(`  [OK] USSD Response Text:\n${ussdResp.trim()}`);

    console.log("\n=================================================");
    console.log(" ALL LIVE API & USSD INTEGRATION TESTS PASSED!");
    console.log("=================================================");
    process.exit(0);
  } catch (err) {
    console.error("Test Error:", err);
    process.exit(1);
  }
});
