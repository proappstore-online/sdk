interface AuthLike {
  token: string | null;
  handleUnauthorized(): void;
}

interface UploadResult {
  key: string;
  size: number;
  contentType: string;
  url: string;
}

interface FileInfo {
  key: string;
  size: number;
  uploaded: string;
}

/**
 * File storage — upload, download, list, delete files.
 * Backed by R2 on the PAS API, scoped to (appId, userId).
 */
export class Storage {
  constructor(
    private readonly appId: string,
    private readonly apiBase: string,
    private readonly auth: AuthLike,
  ) {}

  /** Upload a file. Returns the upload result with the file URL. */
  async upload(path: string, data: Blob | ArrayBuffer | Uint8Array, contentType?: string): Promise<UploadResult> {
    const token = this.auth.token;
    if (!token) throw new Error('Not signed in.');

    const url = `${this.apiBase}/v1/apps/${encodeURIComponent(this.appId)}/storage/${path}`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType || (data instanceof Blob ? data.type : 'application/octet-stream'),
      },
      body: data as BodyInit,
    });

    if (response.status === 401) {
      this.auth.handleUnauthorized();
      throw new Error('Not signed in.');
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`storage.upload failed (${response.status}): ${text}`);
    }

    return (await response.json()) as UploadResult;
  }

  /** Download a file. Returns the Response (use .blob(), .arrayBuffer(), etc.). */
  async download(path: string): Promise<Response> {
    const token = this.auth.token;
    if (!token) throw new Error('Not signed in.');

    const url = `${this.apiBase}/v1/apps/${encodeURIComponent(this.appId)}/storage/${path}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.status === 401) {
      this.auth.handleUnauthorized();
      throw new Error('Not signed in.');
    }
    if (response.status === 404) throw new Error('File not found.');
    if (!response.ok) throw new Error(`storage.download failed: ${response.status}`);

    return response;
  }

  /** Get a URL for a file (for use in <img src> etc). Requires auth header. */
  url(path: string): string {
    return `${this.apiBase}/v1/apps/${encodeURIComponent(this.appId)}/storage/${path}`;
  }

  /** List all files for the current user in this app. */
  async list(): Promise<FileInfo[]> {
    const token = this.auth.token;
    if (!token) throw new Error('Not signed in.');

    const url = `${this.apiBase}/v1/apps/${encodeURIComponent(this.appId)}/files`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.status === 401) {
      this.auth.handleUnauthorized();
      throw new Error('Not signed in.');
    }
    if (!response.ok) throw new Error(`storage.list failed: ${response.status}`);

    const data = (await response.json()) as { files: FileInfo[] };
    return data.files;
  }

  /** Delete a file. */
  async delete(path: string): Promise<void> {
    const token = this.auth.token;
    if (!token) throw new Error('Not signed in.');

    const url = `${this.apiBase}/v1/apps/${encodeURIComponent(this.appId)}/storage/${path}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.status === 401) {
      this.auth.handleUnauthorized();
      throw new Error('Not signed in.');
    }
    if (!response.ok && response.status !== 404) {
      throw new Error(`storage.delete failed: ${response.status}`);
    }
  }
}
