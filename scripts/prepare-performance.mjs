/** Export the current reviewed working source, never dotenv files or verification archives. */
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, symlink } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root=process.cwd(), destination=await mkdtemp(join(tmpdir(),'arctrack-public-performance-'));
const paths=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
for(const path of paths) {
  if(path.split('/').some(part=>part.startsWith('.env') || ['.verification','.git','node_modules'].includes(part))) continue;
  const target=resolve(destination,path);
  if(!target.startsWith(destination+ '\\') && !target.startsWith(destination+'/')) throw Error('Unsafe export path');
  await mkdir(dirname(target),{recursive:true});
  await copyFile(join(root,path),target);
}
await symlink(join(root,'node_modules'),join(destination,'node_modules'),process.platform==='win32'?'junction':'dir');
console.log(destination);
