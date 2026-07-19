const fs = require('fs');
let c = fs.readFileSync(
  './src/services/webScraper.js', 'utf8'
);

const oldUtr = `const utr = (
        additionalInfo.rrn ||
        txn.bankTxnId ||
        txn.utr ||
        ''
      ).toString();`;

const newUtr = `const utr = (
        additionalInfo.rrn ||
        additionalInfo.bankTxnId ||
        txn.bankTxnId ||
        txn.utr ||
        ''
      ).toString();
      
      const rrn = additionalInfo.rrn || '';`;

c = c.replace(oldUtr, newUtr);

fs.writeFileSync('./src/services/webScraper.js', c);
console.log('Fixed UTR!');