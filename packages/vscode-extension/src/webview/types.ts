import { DocumentInfo, IndexStatus } from "markdown-knowledge";

export interface DashboardViewData {
  title: string;
  filePath: string;
  docCount: number;
  indexStatus: IndexStatus;
  hasPersistedIndex: boolean;
  documents: DocumentInfo[];
  activeDocPath: string | null;
}

export interface LoadedDocumentPayload {
  path: string;
  title: string;
  tags: string[];
  size: number;
  tokens: number;
  updatedAt: string;
  raw: string;
  rendered: string;
  frontmatter?: Record<string, any>;
}
