import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import Dashboard from '@/components/Dashboard';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect('/login');
  }

  const sheetUrl = `https://docs.google.com/spreadsheets/d/${
    process.env.GOOGLE_SHEETS_ID ?? ''
  }/edit`;

  return <Dashboard userName={session.user?.name ?? 'Joel'} sheetUrl={sheetUrl} />;
}
