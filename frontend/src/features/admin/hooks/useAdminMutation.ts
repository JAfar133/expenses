import { useMutation } from '@tanstack/react-query';

/** A plain mutation without retries; `onDone` receives the result and the input. */
export function useAdminMutation<TInput, TResult>(
  action: (input: TInput) => Promise<TResult>,
  onDone?: (result: TResult, input: TInput) => unknown,
) {
  return useMutation({
    retry: false,
    mutationFn: action,
    onSuccess: (result, input) => onDone?.(result, input),
  });
}
