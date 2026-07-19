const fs = require('fs');
let c = fs.readFileSync(
  './src/services/webScraper.js', 'utf8'
);

const oldParse = `const amount = (
        txn.txnAmount ||
        txn.amount ||
        txn.totalAmount ||
        '0'
      ).toString();

      const utr = (
        txn.bankTxnId ||
        txn.utr ||
        txn.rrn ||
        txn.referenceNo ||
        ''
      ).toString();

      const txnId = (
        txn.orderId ||
        txn.txnId ||
        txn.transactionId ||
        ''
      ).toString();

      const status = (
        txn.txnStatus === 'TXN_SUCCESS' ||
        txn.txnStatus === 'SUCCESS' ||
        txn.status === 'SUCCESS'
      ) ? 'SUCCESS' : 'PENDING';

      const payerName = (
        txn.customerName ||
        txn.payerName ||
        txn.name ||
        'Unknown'
      );

      const upiId = (
        txn.payerVpa ||
        txn.upiId ||
        txn.vpa ||
        ''
      );`;

const newParse = `// Paytm API field mapping
      const amount = (
        txn.payMoneyAmount?.value ||
        txn.txnAmount ||
        txn.amount ||
        '0'
      ).toString();

      // Amount is in paise (divide by 100)
      // 15000 = ₹150.00
      const amountInRupees = (
        parseFloat(amount) / 100
      ).toFixed(2);

      const additionalInfo = txn.additionalInfo || {};

      const utr = (
        additionalInfo.rrn ||
        txn.bankTxnId ||
        txn.utr ||
        ''
      ).toString();

      const txnId = (
        txn.merchantTransId ||
        txn.bizOrderId ||
        txn.orderId ||
        ''
      ).toString();

      const status = (
        txn.orderStatus === 'SUCCESS' ||
        txn.txnStatus === 'TXN_SUCCESS'
      ) ? 'SUCCESS' : 'PENDING';

      const payerName = (
        additionalInfo.customerName ||
        txn.nickName ||
        txn.customerName ||
        'Unknown'
      );

      const upiId = (
        additionalInfo.virtualPaymentAddr ||
        txn.payerVpa ||
        txn.upiId ||
        ''
      );`;

if (c.includes('txn.payMoneyAmount')) {
  console.log('Already fixed!');
} else if (c.includes(oldParse.slice(0, 50))) {
  c = c.replace(oldParse, newParse);
  console.log('Replaced old parse!');
} else {
  console.log('Pattern not found, trying manual fix...');
  c = c.replace(
    /const amount = \([\s\S]*?'\);/,
    "const amountRaw = (txn.payMoneyAmount?.value || txn.txnAmount || txn.amount || '0').toString(); const amountInRupees = (parseFloat(amountRaw) / 100).toFixed(2);"
  );
}

// Also fix the amount field saved to DB
c = c.replace(
  'amount, utr, txnId, status,',
  'amount: amountInRupees, utr, txnId, status,'
);

fs.writeFileSync('./src/services/webScraper.js', c);
console.log('Fixed!');