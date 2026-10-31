import type { VirtualizerHandle } from 'virtua/solid';

export const scrollToCurrentLine = (
  handle: VirtualizerHandle,
  index: number,
) => {
  const { viewportSize } = handle;
  if (!viewportSize) return;

  const centeredItemOffset = (handle.getItemSize(index) - viewportSize) / 2;
  const centerOffset = handle.getItemOffset(index) + centeredItemOffset;
  const maxScroll = Math.max(0, handle.scrollSize - viewportSize);
  const target = Math.min(Math.max(centerOffset, 0), maxScroll);

  // Scrolling to the current offset leaves virtua's pending jump unflushed.
  if (Math.abs(target - handle.scrollOffset) < 1) return;

  handle.scrollToIndex(index, { smooth: true, align: 'center' });
};
