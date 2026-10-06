import readline from 'node:readline';
import fs from 'node:fs';
const lines=readline.createInterface({input:process.stdin});
lines.on('line',line=>{const r=JSON.parse(line);if(r.id===undefined)return;let result;
 if(r.method==='initialize')result={protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
 else if(r.method==='tools/list')result={tools:[{name:'generate',inputSchema:{type:'object'}},{name:'status',inputSchema:{type:'object'}}]};
 else if(r.method==='tools/call'&&r.params.name==='generate'){if(process.env.CALLS_FILE)fs.appendFileSync(process.env.CALLS_FILE,'generate\n');if(r.params.arguments?.disconnect){process.exit(0)}result={structuredContent:{job_id:'fixture-job-1'}}}
 else result={structuredContent:{status:'succeeded',asset:'https://example.invalid/fixture.png'}};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\n');
});
