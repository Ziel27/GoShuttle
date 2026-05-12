import { api } from '@/services/api';

export const submitSupportMessage = async (subject: string, message: string): Promise<string> => {
  const data = await api('/support/contact', {
    method: 'POST',
    body: JSON.stringify({ subject, message }),
  });
  return data.message as string;
};
