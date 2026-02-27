import { getAccessToken } from './src/comms/google/auth.ts';
const token = await getAccessToken('https://www.googleapis.com/auth/drive.readonly', 'nicholas@nac70x7.com');

async function readFile(id: string, name: string) {
  let res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text/plain`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (res.ok === false) {
    res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }
  const text = await res.text();
  console.log(`\n========== ${name} ==========`);
  console.log(text.slice(0, 8000));
  if (text.length > 8000) console.log(`\n... [TRUNCATED at 8000 chars, total: ${text.length}]`);
}

const files = JSON.parse(process.argv[2] || '[]');
for (const [id, name] of files) {
  await readFile(id, name);
}
