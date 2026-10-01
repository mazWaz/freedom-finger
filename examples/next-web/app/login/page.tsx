// Layar login. Selama belum ada user sama sekali, form yang sama membuat user pertama.
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth, currentUser } from '@/lib/server/session';
import { FormMasuk } from './form-masuk';

export const metadata: Metadata = { title: 'Masuk · Freedom Finger' };

export default async function Login() {
  if (await currentUser()) redirect('/hari-ini');
  return <FormMasuk setup={!(await auth()).hasUsers()} />;
}
