const fs = require('fs');

let c = fs.readFileSync(
  './src/services/webScraper.js', 'utf8'
);

const oldBody = c.match(
  /body: JSON\.stringify\(\{[\s\S]*?\}\)/
)?.[0];

console.log('Found body:', oldBody?.slice(0, 100));

const newBody = `body: JSON.stringify({
              bizTypeList: [
                "ACQUIRING",
                "CASHBACK", 
                "SPLIT_PAYMENT"
              ],
              pageSize: 20,
              pageNum: 1,
              isSort: true,
              orderCreatedStartTime: (() => {
                const d = new Date(
                  Date.now() - 7 * 24 * 60 * 60 * 1000
                );
                const ist = new Date(
                  d.getTime() + (5.5 * 60 * 60 * 1000)
                );
                return ist.toISOString()
                  .slice(0, 19) + '+05:30';
              })(),
              orderCreatedEndTime: (() => {
                const d = new Date();
                const ist = new Date(
                  d.getTime() + (5.5 * 60 * 60 * 1000)
                );
                return ist.toISOString()
                  .slice(0, 19) + '+05:30';
              })(),
              orderStatusList: [
                "SUCCESS",
                "PENDING",
                "FAILURE"
              ]
            })`;

if (oldBody) {
  c = c.replace(oldBody, newBody);
  fs.writeFileSync(
    './src/services/webScraper.js', c
  );
  console.log('Fixed!');
} else {
  console.log('Could not find body to replace!');
  console.log('Search for body: JSON.stringify manually');
}