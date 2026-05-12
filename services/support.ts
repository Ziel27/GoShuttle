import { api } from '@/services/api';

export type SupportTicket = {
  _id: string;
  subject: string;
  message: string;
  status: 'open' | 'closed';
  createdAt: string;
};

export const submitSupportMessage = async (subject: string, message: string): Promise<string> => {
  const data = await api('/support/contact', {
    method: 'POST',
    body: JSON.stringify({ subject, message }),
  });
  return data.message as string;
};

export const getMyTickets = async (): Promise<SupportTicket[]> => {
  const data = await api('/support/tickets');
  return data as SupportTicket[];
};
