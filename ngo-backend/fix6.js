const fs = require('fs');

let c = fs.readFileSync(
  './src/services/webScraper.js', 'utf8'
);

console.log('File loaded, length:', c.length);

// Fix 1: Update utr section to use bizOrderId
c = c.replace(
  `const utr = (
        additionalInfo.rrn ||
        additionalInfo.bankTxnId ||
        txn.bankTxnId ||
        txn.utr ||
        ''
      ).toString();
      
      const rrn = additionalInfo.rrn || '';`,
  `const bizOrderId = txn.bizOrderId || '';
      const utr = bizOrderId;`
);

// Fix 2: Get xsrfToken outside evaluate
c = c.replace(
  `const result = await page.evaluate(async () => {`,
  `let capturedXsrf = '';
    const result = await page.evaluate(async () => {`
);

c = c.replace(
  `return { status, text, xsrfToken: xsrfToken ? 'found' : 'missing' };`,
  `capturedXsrf = xsrfToken;
        return { status, text, xsrfToken: xsrfToken ? 'found' : 'missing' };`
);

// Fix 3: After saving transaction call detail API for RRN
c = c.replace(
  `await Transaction.create({
        ngoId: account.ngoId,
        accountId: account._id,
        platform: account.platform,
        amount: amountInRupees, utr, txnId, status,
        payerName,
        payerUpiId: upiId,
        paymentMode: txn.paymentMode || 'UPI',
        scrapedAt: new Date()
      });

      newCount++;
      console.log(
        'New: Rs.' + amountInRupees +
        ' from ' + payerName +
        ' UTR:' + utr
      );`,
  `// Call detail API to get RRN
      let rrn = '';
      try {
        if (utr) {
          const detailText = await page.evaluate(
            async (orderId, token) => {
              const r = await fetch(
                'https://dashboard.paytm.com/api/v4/order/detail',
                {
                  method: 'POST',
                  credentials: 'include',
                  headers: {
                    'Content-Type': 'application/json',
                    'X-XSRF-TOKEN': token,
                    'X-Requested-With': 'XMLHttpRequest'
                  },
                  body: JSON.stringify({
                    bizOrderId: orderId,
                    isSettlementInfo: true
                  })
                }
              );
              return await r.text();
            },
            utr,
            capturedXsrf
          );
          const detail = JSON.parse(detailText);
          rrn = detail?.additionalInfo?.rrn || '';
          console.log('RRN from detail:', rrn);
        }
      } catch(e) {
        console.log('Detail API error:', e.message);
      }

      await Transaction.create({
        ngoId: account.ngoId,
        accountId: account._id,
        platform: account.platform,
        amount: amountInRupees,
        utr: rrn || utr,
        txnId,
        status,
        payerName,
        payerUpiId: upiId,
        paymentMode: txn.paymentMode || 'UPI',
        scrapedAt: new Date()
      });

      newCount++;
      console.log(
        'New: Rs.' + amountInRupees +
        ' from ' + payerName +
        ' RRN:' + (rrn || 'pending')
      );`
);

fs.writeFileSync('./src/services/webScraper.js', c);
console.log('All fixed!');
console.log('Has bizOrderId:', c.includes('bizOrderId'));
console.log('Has capturedXsrf:', c.includes('capturedXsrf'));
console.log('Has detail API:', c.includes('order/detail'));