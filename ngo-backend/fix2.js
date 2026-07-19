const fs = require('fs');
let c = fs.readFileSync('./src/services/webScraper.js', 'utf8');

c = c.replace(
  /\.toISOString\(\)\.slice\(0,19\)/g,
  '.toISOString().slice(0,19).replace("T"," ")'
);

fs.writeFileSync('./src/services/webScraper.js', c);
console.log('Fixed!');
console.log('Has space replace:', c.includes('.replace("T"," ")'));

// Show the date lines
const lines = c.split('\n');
lines.forEach((line, i) => {
  if (line.includes('orderCreated')) {
    console.log('Line', i, ':', line.trim());
  }
});