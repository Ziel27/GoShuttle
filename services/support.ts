import { api } from '@/services/api';

export type SupportTicket = {
  _id: string;
  subject: string;
  message: string;
  status: 'open' | 'closed';
  createdAt: string;
};

export const submitSupportMessage = async (subject: string, message: string): Promise<string> => {
  const response = await api.post('/support/contact', { subject, message });
  return response.data.message as string;
};

export const getMyTickets = async (): Promise<SupportTicket[]> => {
  const response = await api.get('/support/tickets');
  return response.data as SupportTicket[];
};
