module.exports = function(RED) {
    const sqlite3 = require('sqlite3').verbose();

    function DataPlugHistoryNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        // Configuration interne
        const DB_PATH = '/database/data_storage.db';
        
        node.channels = config.channels || "";
        node.timeRange = config.timeRange || "1d";
        node.aggFunc = config.aggFunc || "AVG";
        node.aggInterval = config.aggInterval || "%Y-%m-%d %H:%M";
        node.category = config.category || "none";

        node.on('input', function(msg) {
            // 1. Préparation des paramètres (Identique à avant)
            let targetChannels = [];
            if (msg.payload && Array.isArray(msg.payload.channels)) {
                targetChannels = msg.payload.channels;
            }
            if (node.channels) {
                const configChannels = node.channels.split(',').map(c => c.trim()).filter(c => c.length > 0);
                targetChannels = [...new Set([...targetChannels, ...configChannels])];
            }

            if (targetChannels.length === 0 && node.category === 'none') {
                node.warn("Aucun channel ou catégorie spécifié.");
                return;
            }

            let from_ms, to_ms;
            if (node.timeRange === 'dynamic' || (msg.payload && msg.payload.from && msg.payload.to)) {
                from_ms = msg.payload ? msg.payload.from : undefined;
                to_ms = msg.payload ? msg.payload.to : undefined;
            }
            if (!from_ms || !to_ms) {
                to_ms = Date.now();
                let duration_ms = 0;
                switch (node.timeRange) {
                    case '15m': duration_ms = 15 * 60 * 1000; break;
                    case '1h': duration_ms = 60 * 60 * 1000; break;
                    case '6h': duration_ms = 6 * 60 * 60 * 1000; break;
                    case '12h': duration_ms = 12 * 60 * 60 * 1000; break;
                    case '24h': duration_ms = 24 * 60 * 60 * 1000; break;
                    case '2d': duration_ms = 2 * 24 * 60 * 60 * 1000; break;
                    case '7d': duration_ms = 7 * 24 * 60 * 60 * 1000; break;
                    case '30d': duration_ms = 30 * 24 * 60 * 60 * 1000; break;
                    default: duration_ms = 60 * 60 * 1000;
                }
                from_ms = to_ms - duration_ms;
            }

            // 2. Connexion BDD (Mode Lecture Seule)
            const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
                if (err) {
                    node.error("Impossible d'ouvrir la BDD: " + err.message, msg);
                    return;
                }
                // Si connexion OK, on lance la suite
                processQuery(db);
            });

            function processQuery(db) {
                // 3. Détection des tables existantes (Async)
                // On cherche les tables qui matchent nos dates
                let startDate = new Date(from_ms);
                let endDate = new Date(to_ms);
                let currentDate = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
                
                let potentialPartitions = [];
                while (currentDate <= endDate) {
                    let year = currentDate.getUTCFullYear();
                    let month = (currentDate.getUTCMonth() + 1).toString().padStart(2, '0');
                    potentialPartitions.push(`hai_data_${year}${month}`);
                    currentDate.setUTCMonth(currentDate.getUTCMonth() + 1);
                }

                if (potentialPartitions.length === 0) {
                    db.close();
                    return;
                }

                // Vérifier quelles tables existent réellement
                const placeholders = potentialPartitions.map(() => '?').join(',');
                const checkSql = `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${placeholders})`;
                
                db.all(checkSql, potentialPartitions, (err, rows) => {
                    if (err) {
                        db.close();
                        node.error("Erreur vérification tables: " + err.message, msg);
                        return;
                    }

                    const validPartitions = rows.map(r => r.name);
                    if (validPartitions.length === 0) {
                        node.warn("Aucune donnée trouvée pour cette période.");
                        msg.payload = {};
                        node.send(msg);
                        db.close();
                        return;
                    }

                    executeMainQuery(db, validPartitions);
                });
            }

            function executeMainQuery(db, partitions) {
                const unionParts = partitions.map(p => `SELECT timestamp, channel_name, value_numeric FROM ${p}`);
                const unionQuery = unionParts.join(' UNION ALL ');

                let channelsFilter = "";
                const channelsListStr = targetChannels.map(c => `'${c}'`).join(',');
                
                if (targetChannels.length > 0 && node.category !== 'none') {
                    channelsFilter = `sub.channel_name IN (SELECT channel_name FROM hai_vars WHERE category = '${node.category}' AND channel_name IN (${channelsListStr}))`;
                } else if (targetChannels.length > 0) {
                    channelsFilter = `sub.channel_name IN (${channelsListStr})`;
                } else if (node.category !== 'none') {
                    channelsFilter = `sub.channel_name IN (SELECT channel_name FROM hai_vars WHERE category = '${node.category}')`;
                } else {
                    channelsFilter = "1=1"; // Sécurité
                }

                let finalQuery = "";
                // Note : Pour sqlite3 (standard), pas de 'unixepoch' modifié dans strftime sur les vieilles versions,
                // mais '/1000' fonctionne généralement bien.
                if (node.aggInterval === 'none') {
                    finalQuery = `SELECT sub.timestamp as ts, sub.value_numeric as value, sub.channel_name FROM (${unionQuery}) AS sub WHERE sub.timestamp BETWEEN ${from_ms} AND ${to_ms} AND ${channelsFilter} ORDER BY ts ASC;`;
                } else if (node.aggInterval === 'last') {
                    finalQuery = `SELECT t1.timestamp as ts, t1.value_numeric as value, t1.channel_name FROM (${unionQuery}) AS t1 INNER JOIN (SELECT channel_name, MAX(timestamp) AS max_ts FROM (${unionQuery}) AS sub WHERE sub.timestamp BETWEEN ${from_ms} AND ${to_ms} AND ${channelsFilter} GROUP BY channel_name) AS t2 ON t1.channel_name = t2.channel_name AND t1.timestamp = t2.max_ts;`;
                } else {
                    let aggExpression = node.aggFunc === 'DELTA' ? '(MAX(sub.value_numeric) - MIN(sub.value_numeric))' : `${node.aggFunc}(sub.value_numeric)`;
                    finalQuery = `SELECT MIN(sub.timestamp) as ts, ${aggExpression} as value, sub.channel_name FROM (${unionQuery}) AS sub WHERE sub.timestamp BETWEEN ${from_ms} AND ${to_ms} AND ${channelsFilter} GROUP BY sub.channel_name, strftime('${node.aggInterval}', sub.timestamp / 1000, 'unixepoch') ORDER BY ts ASC;`;
                }

                db.all(finalQuery, [], (err, dataRows) => {
                    if (err) {
                        db.close();
                        node.error("Erreur requête données: " + err.message, msg);
                        return;
                    }
                    
                    if (!dataRows || dataRows.length === 0) {
                        msg.payload = {};
                        node.send(msg);
                        db.close();
                        return;
                    }

                    // Récupérer les métadonnées
                    const uniqueChannels = [...new Set(dataRows.map(item => item.channel_name))];
                    const metaListStr = uniqueChannels.map(c => `'${c}'`).join(',');
                    
                    db.all(`SELECT channel_name, unit, description, category FROM hai_vars WHERE channel_name IN (${metaListStr})`, [], (err, metaRows) => {
                        db.close(); // Fini avec la DB
                        
                        if (err) {
                            node.warn("Impossible de récupérer les métadonnées, envoi données brutes.");
                        }
                        
                        formatAndSend(dataRows, metaRows || []);
                    });
                });
            }

            function formatAndSend(rows, metaRows) {
                const results = {};
                const varMap = {};
                metaRows.forEach(item => {
                    varMap[item.channel_name] = { unit: item.unit, description: item.description, category: item.category };
                });

                rows.forEach(row => {
                    const channel = row.channel_name;
                    if (!results[channel]) {
                        results[channel] = {
                            min: row.value, max: row.value, avg: 0, sum: 0, count: 0,
                            unit: varMap[channel] ? varMap[channel].unit : null,
                            description: varMap[channel] ? varMap[channel].description : null,
                            category: varMap[channel] ? varMap[channel].category : null,
                            records: []
                        };
                    }
                    results[channel].records.push({ ts: row.ts, value: row.value });
                    if (typeof row.value === 'number') {
                        results[channel].sum += row.value;
                        results[channel].count++;
                    }
                    if (row.value < results[channel].min) results[channel].min = row.value;
                    if (row.value > results[channel].max) results[channel].max = row.value;
                });

                for (const channel in results) {
                    if (results[channel].count > 0) {
                        results[channel].avg = results[channel].sum / results[channel].count;
                    }
                    delete results[channel].sum;
                    delete results[channel].count;
                    
                    if (results[channel].records.length > 0) {
                        const fmtDate = (ts) => new Date(ts).toISOString().replace('T', ' ').replace(/\..+/, '') + ' UTC';
                        results[channel].start_time = fmtDate(results[channel].records[0].ts);
                        results[channel].end_time = fmtDate(results[channel].records[results[channel].records.length - 1].ts);
                    }
                }

                msg.payload = results;
                node.send(msg);
            }
        });
    }
    RED.nodes.registerType("dataplug-history", DataPlugHistoryNode);
}