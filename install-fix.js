// install-fix.js
const { execSync } = require('child_process');
const path = require('path');

// INIT_CWD est le dossier d'où l'utilisateur a lancé l'installation (ex: ~/.node-red)
const userDir = process.env.INIT_CWD || path.resolve(__dirname, '../../');

console.log("--> Vérification des dépendances critiques pour Hexa-AI Edge...");

try {
    // On vérifie si node-red-node-sqlite est visible depuis le dossier utilisateur
    require.resolve('node-red-node-sqlite', { paths: [userDir] });
    console.log("    [OK] node-red-node-sqlite est déjà installé.");
} catch (e) {
    console.log("    [MANQUANT] Installation forcée de node-red-node-sqlite...");
    try {
        // On force l'installation à la racine de l'utilisateur (comme s'il l'avait fait lui-même)
        // --no-save évite de modifier le package.json de l'utilisateur si on veut être discret,
        // mais --save est préférable pour la persistance.
        execSync('npm install node-red-node-sqlite@latest --save', { 
            cwd: userDir, 
            stdio: 'inherit' // Permet à l'utilisateur de voir les logs de compilation
        });
        console.log("    [SUCCÈS] Dépendance installée.");
    } catch (err) {
        console.error("    [ERREUR] Impossible d'installer node-red-node-sqlite automatiquement.");
        console.error("             Veuillez l'installer manuellement via la palette.");
    }
}