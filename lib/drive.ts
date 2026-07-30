import { google } from 'googleapis';

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY no configurados');
  }
  return new google.auth.JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
}

function getDrive() {
  return google.drive({ version: 'v3', auth: getAuth() });
}

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime?: string;
  mimeType?: string;
}

/** Downloads a Drive file's bytes and its filename. */
export async function getDriveFile(fileId: string): Promise<{ name: string; buffer: Buffer }> {
  const drive = getDrive();

  const meta = await drive.files.get({ fileId, fields: 'name', supportsAllDrives: true });
  const name = meta.data.name ?? `${fileId}.bin`;

  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' },
  );
  const buffer = Buffer.from(res.data as ArrayBuffer);

  return { name, buffer };
}

/** Lists files in a folder, most recently modified first. */
export async function listFolderFiles(folderId: string): Promise<DriveFile[]> {
  const drive = getDrive();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, modifiedTime, mimeType)',
    orderBy: 'modifiedTime desc',
    pageSize: 50,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return (res.data.files ?? []).map((f) => ({
    id: f.id ?? '',
    name: f.name ?? '',
    modifiedTime: f.modifiedTime ?? undefined,
    mimeType: f.mimeType ?? undefined,
  }));
}
