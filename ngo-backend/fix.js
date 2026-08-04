console.log('start');
const fs = require('fs');
console.log('fs loaded');

const content = 'hello world';
fs.writeFileSync('./test.txt', content);
console.log('done');