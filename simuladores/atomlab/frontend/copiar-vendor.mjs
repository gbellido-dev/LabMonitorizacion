// Copia lo necesario de node_modules/three a vendor/three (lo sirve FastAPI en /vendor).
import { cpSync, rmSync } from "node:fs";
rmSync("vendor", { recursive: true, force: true });
cpSync("node_modules/three/build", "vendor/three/build", { recursive: true });
cpSync("node_modules/three/examples/jsm", "vendor/three/examples/jsm", { recursive: true });
console.log("Three.js copiado a vendor/three");
