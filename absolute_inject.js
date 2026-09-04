const fs = require('fs');
const path = require('path');

const worldPath = path.join(__dirname, 'packages', 'render', 'src', 'world.ts');

if (!fs.existsSync(worldPath)) {
    console.error("[-] Error: Could not find world.ts");
    process.exit(1);
}

console.log("[*] Reading world.ts...");
let content = fs.readFileSync(worldPath, 'utf8');

// 1. Clean out any hidden duplicate markers first
const cleanupRegex = /\/\/ === SOUTH_ST_SECTOR_START ===[\s\S]*?\/\/ === SOUTH_ST_SECTOR_END ===/g;
content = content.replace(cleanupRegex, '');

const lines = content.split('\n');
console.log(`[*] Current file size: ${lines.length} lines.`);

// 2. Define the exact code to execute inside the function body using deps.scene
const southStreetCode = `
    // === SOUTH_ST_SECTOR_START ===
    // High-fidelity South Street assets injected via absolute line index
    if (deps && deps.scene && typeof THREE !== 'undefined') {
        console.log("[+] Rendering South Street environment elements inside createWorld scope...");
        const concreteMat = new THREE.MeshLambertMaterial({ color: 0xB9B7AE });
        const brickMat = new THREE.MeshLambertMaterial({ color: 0x8A4F45 });
        const glassMat = new THREE.MeshLambertMaterial({ color: 0x4A6B82, transparent: true, opacity: 0.6 });

        // A. Elevated Railway Retaining Wall (Right side)
        const wallGeo = new THREE.BoxGeometry(450, 6, 4);
        const railWall = new THREE.Mesh(wallGeo, concreteMat);
        railWall.position.set(450, 3, 412);
        deps.scene.add(railWall);

        // B. Lucas Oil Stadium Facade (Turn 6 Corner)
        const stadiumGroup = new THREE.Group();
        const hullGeo = new THREE.BoxGeometry(160, 48, 140);
        const hull = new THREE.Mesh(hullGeo, brickMat);
        stadiumGroup.add(hull);

        const windowGeo = new THREE.BoxGeometry(120, 30, 2);
        const northWindow = new THREE.Mesh(windowGeo, glassMat);
        northWindow.position.set(0, 4, 71);
        stadiumGroup.add(northWindow);

        stadiumGroup.position.set(150, 24, 490);
        deps.scene.add(stadiumGroup);

        // C. Left-side Commercial Footprints
        const shopGeo = new THREE.BoxGeometry(80, 12, 45);
        const commercialBlock = new THREE.Mesh(shopGeo, brickMat);
        commercialBlock.position.set(320, 6, 365);
        deps.scene.add(commercialBlock);
    }
    // === SOUTH_ST_SECTOR_END ===
`;

// 3. Inject exactly one line below the opening brace of createWorld (Line 145 -> Array Index 145)
console.log("[*] Injecting code directly inside function body block entry window...");
lines.splice(145, 0, southStreetCode);

fs.writeFileSync(worldPath, lines.join('\n'), 'utf8');
console.log("[+] Success! world.ts has been patched smoothly via static indexing.");