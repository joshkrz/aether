import { constants } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

type ParsedRequestPath = { success: true; pathname: string } | { success: false };

interface ServeGeneratedWebAppOptions {
  method: string;
  pathname: string;
  response: ServerResponse;
  webRoot: string;
}

const contentTypes: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
};

const writeText = (response: ServerResponse, statusCode: number, body: string): void => {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'text/plain; charset=utf-8');
  response.setHeader('content-length', Buffer.byteLength(body));
  response.end(body);
};

const isMissingFileError = (error: unknown): boolean => {
  if (!(error instanceof Error) || !('code' in error)) {
    return false;
  }

  return ['EISDIR', 'ENOENT', 'ENOTDIR'].includes(String(error.code));
};

const readFileIfPresent = async (filePath: string): Promise<Buffer | undefined> => {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    throw error;
  }
};

const isWithinRoot = (webRoot: string, filePath: string): boolean =>
  filePath === webRoot || filePath.startsWith(`${webRoot}${sep}`);

const isGeneratedAssetPath = (pathname: string): boolean =>
  pathname === '/_nuxt' || pathname.startsWith('/_nuxt/');

const sendFile = (
  response: ServerResponse,
  method: string,
  pathname: string,
  filePath: string,
  contents: Buffer,
): void => {
  const extension = extname(filePath).toLowerCase();

  response.statusCode = 200;
  response.setHeader('content-type', contentTypes[extension] ?? 'application/octet-stream');
  response.setHeader('content-length', contents.byteLength);
  response.setHeader(
    'cache-control',
    isGeneratedAssetPath(pathname) && extension !== '.html'
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  );

  response.end(method === 'HEAD' ? undefined : contents);
};

export const parseRequestPath = (requestUrl: string): ParsedRequestPath => {
  const queryStart = requestUrl.indexOf('?');
  const rawPathname = queryStart === -1 ? requestUrl : requestUrl.slice(0, queryStart);

  try {
    const pathname = decodeURIComponent(rawPathname);
    const segments = pathname.split('/');

    if (
      !pathname.startsWith('/') ||
      pathname.includes('\\') ||
      pathname.includes('\0') ||
      segments.some((segment) => segment === '.' || segment === '..')
    ) {
      return { success: false };
    }

    return { success: true, pathname };
  } catch {
    return { success: false };
  }
};

export const resolveGeneratedWebRoot = async (
  configuredPath: string,
  workingDirectory = process.cwd(),
): Promise<string> => {
  const webRoot = resolve(workingDirectory, configuredPath);

  try {
    const [rootStats, indexStats] = await Promise.all([
      stat(webRoot),
      stat(join(webRoot, 'index.html')),
      access(webRoot, constants.R_OK),
      access(join(webRoot, 'index.html'), constants.R_OK),
    ]);

    if (!rootStats.isDirectory() || !indexStats.isFile()) {
      throw new Error('invalid generated web root');
    }
  } catch {
    throw new Error('AETHER_WEB_ROOT must point to readable generated web assets');
  }

  return webRoot;
};

export const serveGeneratedWebApp = async ({
  method,
  pathname,
  response,
  webRoot,
}: ServeGeneratedWebAppOptions): Promise<void> => {
  if (method !== 'GET' && method !== 'HEAD') {
    response.setHeader('allow', 'GET, HEAD');
    writeText(response, 405, 'Method not allowed');
    return;
  }

  const resolvedWebRoot = resolve(webRoot);
  const requestedPath =
    pathname === '/'
      ? join(resolvedWebRoot, 'index.html')
      : resolve(resolvedWebRoot, `.${pathname}`);

  if (!isWithinRoot(resolvedWebRoot, requestedPath)) {
    writeText(response, 400, 'Invalid request path');
    return;
  }

  const requestedFile = await readFileIfPresent(requestedPath);

  if (requestedFile !== undefined) {
    sendFile(response, method, pathname, requestedPath, requestedFile);
    return;
  }

  if (isGeneratedAssetPath(pathname) || extname(pathname) !== '') {
    writeText(response, 404, 'Not found');
    return;
  }

  const indexPath = join(resolvedWebRoot, 'index.html');
  const indexFile = await readFileIfPresent(indexPath);

  if (indexFile === undefined) {
    writeText(response, 500, 'Generated web app is unavailable');
    return;
  }

  sendFile(response, method, pathname, indexPath, indexFile);
};
