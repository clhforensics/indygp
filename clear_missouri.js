const fs = require('fs');
const path = require('path');

const targetPath = path.join(process.cwd(), 'packages', 'render', 'src', 'world.ts');

if (!fs.existsSync(targetPath)) {
    console.error("[-] Error: Could not find world.ts");
    process.exit(1);
}

let content = fs.readFileSync(targetPath, 'utf8');

// Scrub all variations of Missouri injection blocks out entirely
const cleanRegex = /\/\/ === MISSOURI_ST_SECTOR_START ===[\s\S]*?\/\/ === MISSOURI_ST_SECTOR_END ===\n?/g;
content = content.replace(cleanRegex, '');

// Double check for any stray un-commented markers matching the error
content = content.replace(/MISSOURI_FIXED_V2/g, '// MISSOURI_FIXED_V2');

fs.writeFileSync(targetPath, content, 'utf8');
console.log("[+] Missouri sector cleared. Ready for a clean slate.");
