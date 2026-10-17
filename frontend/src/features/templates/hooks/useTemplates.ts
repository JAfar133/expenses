import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { applyOrder } from '../model/reorder.ts';
import {
  createTemplate,
  deleteTemplate,
  fetchTemplates,
  approveTemplate,
  reorderGroupTemplates,
  reorderTemplates,
  shareTemplate,
  setTemplateHidden,
  updateTemplate,
  type Template,
  type TemplateInput,
} from '../api/templates.api.ts';

type OrderContext = { previous?: Template[] };

export const TEMPLATES_KEY = ['templates'];

/** Templates of the user: their own and the group's. A failed load just means there are none to show. */
export function useTemplates() {
  return useQuery({
    queryKey: TEMPLATES_KEY,
    queryFn: fetchTemplates,
    staleTime: 60_000,
    retry: false,
  });
}

/** Changes of templates; each one refreshes the list afterwards. */
export function useTemplateActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY });
  const options = { retry: false, onSuccess: refresh } as const;

  /** A reorder request whose result is shown at once; an error rolls the list back. */
  const optimisticOrder = (save: (ids: string[]) => Promise<unknown>) => ({
    retry: false,
    mutationFn: save,
    onMutate: async (ids: string[]) => {
      await queryClient.cancelQueries({ queryKey: TEMPLATES_KEY });
      const previous = queryClient.getQueryData<Template[]>(TEMPLATES_KEY);
      if (previous) {
        queryClient.setQueryData(TEMPLATES_KEY, applyOrder(previous, ids));
      }
      return { previous };
    },
    onError: (_error: unknown, _ids: string[], context?: OrderContext) => {
      if (context?.previous) queryClient.setQueryData(TEMPLATES_KEY, context.previous);
    },
    onSettled: refresh,
  });

  return {
    create: useMutation({ ...options, mutationFn: createTemplate }),
    update: useMutation({
      ...options,
      mutationFn: ({ id, input }: { id: string; input: TemplateInput }) =>
        updateTemplate(id, input),
    }),
    share: useMutation({ ...options, mutationFn: shareTemplate }),
    approve: useMutation({ ...options, mutationFn: approveTemplate }),
    remove: useMutation({ ...options, mutationFn: deleteTemplate }),
    // The list follows the drop at once; a failure puts the old order back
    reorder: useMutation<unknown, Error, string[], OrderContext>(optimisticOrder(reorderTemplates)),
    reorderGroup: useMutation<unknown, Error, string[], OrderContext>(
      optimisticOrder(reorderGroupTemplates),
    ),
    hide: useMutation({
      ...options,
      mutationFn: ({ id, hidden }: { id: string; hidden: boolean }) =>
        setTemplateHidden(id, hidden),
    }),
  };
}
