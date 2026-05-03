// src/plugins/diskSpace.ts
import { registerPlugin } from '@capacitor/core';

type DiskSpaceInfo = {
  availableBytes: number;
  totalBytes: number;
};

export const DiskSpace = registerPlugin<{
  getInfo(): Promise<DiskSpaceInfo>;
}>('DiskSpace');
