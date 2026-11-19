import type { TextToastAction } from '@/types/queue';

type ToastTarget = {
  handleAddToToastAction?: (action: TextToastAction) => void;
  toastService?: { show?: (message: string) => void };
};

export const createAddToToastAction = (message: string): TextToastAction => ({
  addToToastAction: {
    item: {
      notificationTextRenderer: {
        successResponseText: { simpleText: message },
      },
    },
  },
});

// Newer YTM builds drop toastService; fall back to it only when the new API is absent.
export const showToast = (
  app: ToastTarget | null | undefined,
  message: string,
) => {
  if (typeof app?.handleAddToToastAction === 'function') {
    app.handleAddToToastAction(createAddToToastAction(message));
  } else {
    app?.toastService?.show?.(message);
  }
};
