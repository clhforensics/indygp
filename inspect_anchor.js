const fs = require('fs');
const path = require('path');

const worldPath = path.join(__dirname, 'packages', 'render', 'src', 'world.ts');

if (!fs.existsSync(worldPath)) {
    console.error("[-] Error: Could not find world.ts");
    process.exit(1);
}

const content = fs.readFileSync(worldPath, 'utf8');
const lines = content.split('\n');

// Clean out the latest broken attempt so the file remains stable
let scrubbedContent = content.replace(/\/\/ === SOUTH_ST_SECTOR_START ===[\s\S]*?\/\/ === SOUTH_ST_SECTOR_END ===/g, '');
fs.writeFileSync(worldPath, scrubbedContent, 'utf8');
console.log("[+] Removed the broken block. File is clean.");

console.log("\n=================== ANCHOR SCOPE INSPECTION ===================");
// Print lines 950 to 980 to see the exact scene variable name
for (let i = 945; i < 980; i++) {
    if (lines[i] !== undefined) {
        console.log(`Line ${i + 1}: ${lines[i]}`);
    }
}
console.log("===============================================================");