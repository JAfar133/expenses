import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchBroadcasts, fetchRecipients, sendBroadcast } from '../api/broadcast.api.ts';

const BROADCASTS_KEY = ['broadcast', 'sent'];

/** Who the person may write to. A 403 means they may not write to anyone: the card is not shown at all. */
export const useRecipients = () =>
  useQuery({
    queryKey: ['broadcast', 'recipients'],
    queryFn: fetchRecipients,
    retry: false,
    staleTime: 60_000,
  });

export const useBroadcasts = () =>
  useQuery({ queryKey: BROADCASTS_KEY, queryFn: fetchBroadcasts, retry: false });

export function useSendBroadcast() {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: sendBroadcast,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: BROADCASTS_KEY }),
  });
}
