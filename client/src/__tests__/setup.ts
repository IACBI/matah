import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library only auto-cleans when Vitest globals are on. Without this,
// every render stayed in the document and queries matched across tests.
afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});
