import { useQuery } from '@tanstack/react-query';
import { fetchAiStatus } from '../api/ai.api.ts';

export const AI_STATUS_KEY = ['ai', 'status'];

export function useAiStatus() {
  return useQuery({
    queryKey: AI_STATUS_KEY,
    queryFn: fetchAiStatus,
    staleTime: 60_000,
    retry: false,
  });
}

/** Can a receipt be parsed by the AI here (everything new stays hidden otherwise). */
export const useAiAvailable = () => useAiStatus().data?.available === true;
