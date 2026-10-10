import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const out=process.env.KINO_REGRESSION_OUT??'artifacts/second-pass-regression';fs.mkdirSync(out,{recursive:true});
const suites=[
  ['qa','.tools/qa.mjs','artifacts/qa/report.json','qa'],
  ['routes','.tools/test-routes.mjs','artifacts/physical-routes.json',null],
  ['extras','.tools/test-extras.mjs','artifacts/qa/extras-report.json','qa'],
  ['completion','.tools/test-kino-completion.mjs','artifacts/kino-completion/report.json','kino-completion'],
  ['melee','.tools/test-melee.mjs','artifacts/melee/report.json','melee'],
  ['zombies','.tools/test-zombies.mjs','artifacts/zombies/report.json','zombies'],
].filter(([name])=>!process.env.KINO_SUITES||process.env.KINO_SUITES.split(',').includes(name));
function hashes(){return Object.fromEntries(fs.readdirSync('export/web').filter(f=>/\.(js|css|html)$/.test(f)).concat(['game-data.json','audio/manifest.json']).sort().map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join('export/web',f))).digest('hex')]));}
const summary={startedAt:new Date().toISOString(),url:process.env.KINO_URL??'http://127.0.0.1:5173/',qaVideo:false,notes:['Original suite assertions retained.','These are automated functional checks, not a full human playthrough.','Performance was not measured; a separate progression browser may have run concurrently.'],sourceBefore:hashes(),suites:[]};
function save(){fs.writeFileSync(path.join(out,'suite-summary.json'),JSON.stringify(summary,null,2)+'\n');}
for(const [name,script,reportPath,screenshotDir]of suites){
  const started=Date.now(),logPath=path.join(out,name+'.log'),stream=fs.createWriteStream(logPath);let tail='';console.log('START',name);
  const child=spawn(process.execPath,[script],{env:{...process.env,KINO_NO_VIDEO:'1'},stdio:['ignore','pipe','pipe']});
  for(const source of [child.stdout,child.stderr])source.on('data',chunk=>{stream.write(chunk);tail=(tail+chunk).slice(-5000);});
  const exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});await new Promise(resolve=>stream.end(resolve));
  let report=null;if(fs.existsSync(reportPath)&&fs.statSync(reportPath).mtimeMs>=started-1000){report=JSON.parse(fs.readFileSync(reportPath));fs.copyFileSync(reportPath,path.join(out,name+'-report.json'));}
  const checks=Array.isArray(report)?report:report?.checks??[],errors=Array.isArray(report)?[]:report?.errors??[];
  const row={name,exitCode,checks:checks.length,passed:checks.filter(c=>c.passed).length,failed:checks.filter(c=>!c.passed).length,browserErrors:errors.length,report:report?name+'-report.json':null,durationMs:Date.now()-started};summary.suites.push(row);
  if(screenshotDir){const dir=path.join('artifacts',screenshotDir),dest=path.join(out,'screenshots',name);fs.mkdirSync(dest,{recursive:true});for(const file of fs.readdirSync(dir)){const source=path.join(dir,file);if(/\.(png|webm)$/.test(file)&&fs.statSync(source).mtimeMs>=started-1000)fs.copyFileSync(source,path.join(dest,file));}}
  save();console.log('RESULT',JSON.stringify(row));
  if(exitCode!==0||row.failed||!report){console.error(tail);process.exitCode=1;break;}
}
summary.finishedAt=new Date().toISOString();summary.sourceAfter=hashes();summary.modifiedDuringRun=Object.keys(summary.sourceAfter).filter(k=>summary.sourceBefore[k]!==summary.sourceAfter[k]);summary.totalChecks=summary.suites.reduce((n,s)=>n+s.checks,0);summary.passed=summary.suites.reduce((n,s)=>n+s.passed,0);summary.failed=summary.suites.reduce((n,s)=>n+s.failed,0);summary.browserErrors=summary.suites.reduce((n,s)=>n+s.browserErrors,0);save();
console.log('TOTAL',summary.passed+'/'+summary.totalChecks,'checks;',summary.browserErrors,'browser errors;',summary.modifiedDuringRun.length,'source files changed during run');
