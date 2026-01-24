/**
 * TUS Protocol Upload Composable
 *
 * Provides resumable file uploads using the TUS protocol.
 * Supports pause/resume, parallel uploads, and progress tracking.
 *
 * @see https://tus.io/
 */

import { computed, ref, useRuntimeConfig } from "#imports";
import type {
  LtUploadItem,
  LtUploadOptions,
  LtUploadProgress,
  UseLtTusUploadReturn,
} from "../types";

// Type for tus.Upload - import type only to avoid ESM issues
type TusUpload = import("tus-js-client").Upload;

// Lazy-loaded tus module
let tusModule: typeof import("tus-js-client") | null = null;

/**
 * Load tus-js-client dynamically to avoid ESM/CJS issues
 */
async function getTusModule(): Promise<typeof import("tus-js-client")> {
  if (!tusModule) {
    try {
      tusModule = await import("tus-js-client");
    } catch {
      throw new Error(
        "[useLtTusUpload] tus-js-client is not installed. " +
          "Please install it: npm install tus-js-client",
      );
    }
  }
  return tusModule;
}

/**
 * TUS Upload composable with pause/resume support
 *
 * @param defaultOptions - Default options for all uploads
 * @returns Upload management functions and state
 *
 * @example
 * ```typescript
 * const { addFiles, uploads, totalProgress, isUploading } = useLtTusUpload({
 *   endpoint: '/api/files/upload',
 *   onSuccess: (item) => console.log('Uploaded:', item.url),
 * });
 *
 * // Add files from input
 * function handleFileSelect(event: Event) {
 *   const input = event.target as HTMLInputElement;
 *   if (input.files) {
 *     addFiles(Array.from(input.files));
 *   }
 * }
 * ```
 */
export function useLtTusUpload(defaultOptions: LtUploadOptions = {}): UseLtTusUploadReturn {
  const config = useRuntimeConfig();
  const tusConfig = config.public.ltExtensions?.tus;

  // State
  const uploadItems = ref<Map<string, LtUploadItem>>(new Map());
  const tusUploads = ref<Map<string, TusUpload>>(new Map());

  // Default config from module options or provided options
  const defaultConfig: LtUploadOptions = {
    autoStart: true,
    chunkSize: tusConfig?.defaultChunkSize || 5 * 1024 * 1024, // 5MB chunks
    endpoint: tusConfig?.defaultEndpoint || "/files/upload",
    parallelUploads: 3,
    retryDelays: [0, 1000, 3000, 5000, 10000],
    ...defaultOptions,
  };

  // Computed
  const uploads = computed(() => Array.from(uploadItems.value.values()));
  const isUploading = computed(() => uploads.value.some((u) => u.status === "uploading"));
  const totalProgress = computed<LtUploadProgress>(() => {
    const items = uploads.value;
    if (items.length === 0) {
      return { bytesTotal: 0, bytesUploaded: 0, percentage: 0, remainingTime: 0, speed: 0 };
    }

    const bytesUploaded = items.reduce((acc, i) => acc + i.progress.bytesUploaded, 0);
    const bytesTotal = items.reduce((acc, i) => acc + i.progress.bytesTotal, 0);
    const speed = items.reduce((acc, i) => acc + i.progress.speed, 0);

    return {
      bytesTotal,
      bytesUploaded,
      percentage: bytesTotal > 0 ? Math.round((bytesUploaded / bytesTotal) * 100) : 0,
      remainingTime: speed > 0 ? Math.ceil((bytesTotal - bytesUploaded) / speed) : 0,
      speed,
    };
  });

  // Helper: Generate unique ID
  function generateId(): string {
    return `upload_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  // Helper: Calculate speed with smoothing
  function createSpeedTracker() {
    let lastBytes = 0;
    let lastTime = Date.now();
    let smoothedSpeed = 0;

    return (bytesUploaded: number): number => {
      const now = Date.now();
      const timeDiff = (now - lastTime) / 1000;
      const bytesDiff = bytesUploaded - lastBytes;

      if (timeDiff > 0) {
        const currentSpeed = bytesDiff / timeDiff;
        // Exponential moving average for smoother display
        smoothedSpeed =
          smoothedSpeed === 0 ? currentSpeed : smoothedSpeed * 0.7 + currentSpeed * 0.3;
      }

      lastBytes = bytesUploaded;
      lastTime = now;

      return Math.round(smoothedSpeed);
    };
  }

  // Update item in map (triggers reactivity)
  function updateItem(id: string, updates: Partial<LtUploadItem>): void {
    const item = uploadItems.value.get(id);
    if (item) {
      const newMap = new Map(uploadItems.value);
      newMap.set(id, { ...item, ...updates });
      uploadItems.value = newMap;
    }
  }

  // Create TUS upload instance
  async function createTusUpload(item: LtUploadItem, options: LtUploadOptions): Promise<TusUpload> {
    const tus = await getTusModule();
    const speedTracker = createSpeedTracker();

    return new tus.Upload(item.file, {
      chunkSize: options.chunkSize || defaultConfig.chunkSize,
      endpoint: options.endpoint || defaultConfig.endpoint,
      headers: options.headers,
      metadata: {
        filename: item.file.name,
        filetype: item.file.type,
        ...options.metadata,
        ...item.metadata,
      },
      onBeforeRequest: (req) => {
        const xhr = req.getUnderlyingObject() as XMLHttpRequest;
        xhr.withCredentials = true;
      },
      onError: (error) => {
        updateItem(item.id, {
          error: error.message,
          status: "error",
        });
        options.onError?.(uploadItems.value.get(item.id)!, error);
      },

      onProgress: (bytesUploaded, bytesTotal) => {
        const speed = speedTracker(bytesUploaded);
        const percentage = Math.round((bytesUploaded / bytesTotal) * 100);
        const remainingTime = speed > 0 ? Math.ceil((bytesTotal - bytesUploaded) / speed) : 0;

        updateItem(item.id, {
          progress: { bytesTotal, bytesUploaded, percentage, remainingTime, speed },
        });

        options.onProgress?.(uploadItems.value.get(item.id)!);
      },

      onShouldRetry: (err) => {
        const status = (
          err as { originalResponse?: { getStatus?: () => number } }
        ).originalResponse?.getStatus?.();
        // Don't retry on 4xx errors (except 429 Too Many Requests)
        if (status && status >= 400 && status < 500 && status !== 429) {
          return false;
        }
        return true;
      },

      onSuccess: () => {
        const tusUpload = tusUploads.value.get(item.id);
        const currentItem = uploadItems.value.get(item.id);
        updateItem(item.id, {
          completedAt: new Date(),
          progress: { ...currentItem!.progress, percentage: 100 },
          status: "completed",
          url: tusUpload?.url ?? undefined,
        });
        options.onSuccess?.(uploadItems.value.get(item.id)!);
      },

      retryDelays: options.retryDelays || defaultConfig.retryDelays,
    });
  }

  // Actions
  async function addFiles(files: File | File[]): Promise<string[]> {
    const fileArray = Array.isArray(files) ? files : [files];
    const ids: string[] = [];

    for (const file of fileArray) {
      const id = generateId();
      const item: LtUploadItem = {
        file,
        id,
        metadata: defaultConfig.metadata,
        progress: {
          bytesTotal: file.size,
          bytesUploaded: 0,
          percentage: 0,
          remainingTime: 0,
          speed: 0,
        },
        status: "idle",
      };

      const newMap = new Map(uploadItems.value);
      newMap.set(id, item);
      uploadItems.value = newMap;

      const tusUpload = await createTusUpload(item, defaultConfig);
      tusUploads.value.set(id, tusUpload);

      ids.push(id);
    }

    if (defaultConfig.autoStart) {
      startAll();
    }

    return ids;
  }

  function startUpload(id: string): void {
    const item = uploadItems.value.get(id);
    const tusUpload = tusUploads.value.get(id);

    if (item && tusUpload && item.status !== "uploading") {
      updateItem(id, { startedAt: new Date(), status: "uploading" });

      // Check for previous uploads to resume
      tusUpload.findPreviousUploads().then((previousUploads) => {
        const previousUpload = previousUploads[0];
        if (previousUpload) {
          tusUpload.resumeFromPreviousUpload(previousUpload);
        }
        tusUpload.start();
      });
    }
  }

  function startAll(): void {
    const pending = uploads.value.filter((u) => u.status === "idle" || u.status === "paused");
    const currentlyUploading = uploads.value.filter((u) => u.status === "uploading").length;
    const limit = (defaultConfig.parallelUploads || 3) - currentlyUploading;

    pending.slice(0, Math.max(0, limit)).forEach((item) => startUpload(item.id));
  }

  function pauseUpload(id: string): void {
    const tusUpload = tusUploads.value.get(id);
    if (tusUpload) {
      tusUpload.abort();
      updateItem(id, { status: "paused" });
    }
  }

  function pauseAll(): void {
    uploads.value.filter((u) => u.status === "uploading").forEach((item) => pauseUpload(item.id));
  }

  function resumeUpload(id: string): void {
    startUpload(id);
  }

  function resumeAll(): void {
    uploads.value.filter((u) => u.status === "paused").forEach((item) => resumeUpload(item.id));
  }

  function cancelUpload(id: string): void {
    const tusUpload = tusUploads.value.get(id);
    if (tusUpload) {
      tusUpload.abort();
    }
    tusUploads.value.delete(id);

    const newMap = new Map(uploadItems.value);
    newMap.delete(id);
    uploadItems.value = newMap;
  }

  function cancelAll(): void {
    uploads.value.forEach((item) => cancelUpload(item.id));
  }

  function removeUpload(id: string): void {
    cancelUpload(id);
  }

  function clearCompleted(): void {
    uploads.value.filter((u) => u.status === "completed").forEach((item) => removeUpload(item.id));
  }

  function retryUpload(id: string): void {
    const item = uploadItems.value.get(id);
    if (item && item.status === "error") {
      updateItem(id, { error: undefined, status: "idle" });
      startUpload(id);
    }
  }

  function getUpload(id: string): LtUploadItem | undefined {
    return uploadItems.value.get(id);
  }

  return {
    addFiles,
    cancelAll,
    cancelUpload,
    clearCompleted,
    getUpload,
    isUploading,
    pauseAll,
    pauseUpload,
    removeUpload,
    resumeAll,
    resumeUpload,
    retryUpload,
    startAll,
    startUpload,
    totalProgress,
    uploads,
  };
}
