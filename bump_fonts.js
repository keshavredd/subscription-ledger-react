const fs = require('fs');
const path = require('path');

const targetFile = path.join(__dirname, 'src/App.jsx');
let content = fs.readFileSync(targetFile, 'utf8');

// Use a replacement map and a single regex to avoid double-bumping
const replacements = {
  'text-3xl': 'text-4xl',
  'text-2xl': 'text-3xl',
  'text-xl': 'text-2xl',
  'text-lg': 'text-xl',
  'text-base': 'text-lg',
  'text-sm': 'text-base',
  'text-xs': 'text-sm',
  'text-[10px]': 'text-xs'
};

const regex = new RegExp(Object.keys(replacements).map(k => k.replace(/\[/g, '\\[').replace(/\]/g, '\\]')).join('|'), 'g');

content = content.replace(regex, match => replacements[match]);

fs.writeFileSync(targetFile, content, 'utf8');
console.log('Font sizes bumped successfully in App.jsx');
