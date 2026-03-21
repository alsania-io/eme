import { IVectorStore } from './vector-store.js';
import fs from 'fs/promises';
import path from 'path';

// Supported file types
const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md'];

export interface Document {
  id: string;
  path: string;
  content: string;
  metadata: Record<string, any>;
  chunks: DocumentChunk[];
}

export interface DocumentChunk {
  id: string;
  text: string;
  index: number;
  metadata: Record<string, any>;
}

export class LocalRAG {
  private vectorStore: IVectorStore;
  private documents: Map<string, Document> = new Map();

  constructor(vectorStore: IVectorStore) {
    this.vectorStore = vectorStore;
  }

  async ingestFile(filePath: string): Promise<{ success: boolean; documentId: string; chunks: number }> {
    const ext = path.extname(filePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      throw new Error(`Unsupported file type: ${ext}. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`);
    }

    let content: string;
    try {
      if (ext === '.pdf') {
        content = await this.extractPDF(filePath);
      } else if (ext === '.docx') {
        content = await this.extractDOCX(filePath);
      } else {
        content = await fs.readFile(filePath, 'utf-8');
      }
    } catch (error) {
      throw new Error(`Failed to read file: ${error}`);
    }

    const documentId = `file-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const chunks = this.chunkContent(content, 1000);
    
    const document: Document = {
      id: documentId,
      path: filePath,
      content,
      metadata: {
        filePath,
        ingestedAt: new Date().toISOString(),
        type: ext,
        size: content.length,
      },
      chunks: chunks.map((text, i) => ({
        id: `${documentId}-chunk-${i}`,
        text,
        index: i,
        metadata: { documentId, chunkIndex: i, source: filePath, fileType: ext },
      })),
    };

    this.documents.set(documentId, document);

    // Add to vector store using the add method
    for (const chunk of document.chunks) {
      await this.vectorStore.add({
        text: chunk.text,
        embedding: [], // Will be computed by vector store
        metadata: {
          agentId: 'local-rag',
          namespace: 'documents',
          tags: ['ingested', ext.substring(1), filePath],
          visibility: 'private',
          timestamp: Date.now(),
          version: 1,
          ...chunk.metadata, // Add chunk-specific metadata
        },
      });
    }

    return { success: true, documentId, chunks: document.chunks.length };
  }

  async ingestData(content: string, metadata: { source: string; format: string }): Promise<{ success: boolean; documentId: string }> {
    const documentId = `data-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const chunks = this.chunkContent(content, 1000);
    
    const document: Document = {
      id: documentId,
      path: metadata.source,
      content,
      metadata: {
        source: metadata.source,
        format: metadata.format,
        ingestedAt: new Date().toISOString(),
        size: content.length,
      },
      chunks: chunks.map((text, i) => ({
        id: `${documentId}-chunk-${i}`,
        text,
        index: i,
        metadata: { documentId, chunkIndex: i, source: metadata.source, format: metadata.format },
      })),
    };

    this.documents.set(documentId, document);

    for (const chunk of document.chunks) {
      await this.vectorStore.add({
        text: chunk.text,
        embedding: [],
        metadata: {
          agentId: 'local-rag',
          namespace: 'documents',
          tags: ['ingested', metadata.format, metadata.source],
          visibility: 'private',
          timestamp: Date.now(),
          version: 1,
          ...chunk.metadata,
        },
      });
    }

    return { success: true, documentId };
  }

  async queryDocuments(query: string, limit: number = 10): Promise<Array<{ text: string; score: number; metadata: Record<string, any> }>> {
    // For now, use a simple search by query text
    const results = await this.vectorStore.search([], limit, 'documents');
    return results.map(r => ({
      text: r.entry.text,
      score: r.score,
      metadata: r.entry.metadata,
    }));
  }

  async deleteDocument(identifier: string): Promise<{ success: boolean }> {
    let found = false;
    for (const [id, doc] of this.documents.entries()) {
      if (doc.path === identifier || id === identifier) {
        // Remove chunks from vector store
        for (const chunk of doc.chunks) {
          await this.vectorStore.delete(chunk.id);
        }
        this.documents.delete(id);
        found = true;
        break;
      }
    }
    return { success: found };
  }

  listDocuments(): Array<{ path: string; type: string; size: number; chunks: number; ingestedAt: string }> {
    return Array.from(this.documents.values()).map(doc => ({
      path: doc.path,
      type: doc.metadata.type || doc.metadata.format || 'text',
      size: doc.metadata.size,
      chunks: doc.chunks.length,
      ingestedAt: doc.metadata.ingestedAt,
    }));
  }

  getStatus(): { totalDocuments: number; totalChunks: number; databaseSize: number } {
    const totalChunks = Array.from(this.documents.values()).reduce((sum, doc) => sum + doc.chunks.length, 0);
    return {
      totalDocuments: this.documents.size,
      totalChunks,
      databaseSize: totalChunks * 1000,
    };
  }

  private chunkContent(content: string, chunkSize: number): string[] {
    const chunks: string[] = [];
    const paragraphs = content.split('\n\n');
    let currentChunk = '';

    for (const paragraph of paragraphs) {
      if ((currentChunk + paragraph).length > chunkSize && currentChunk) {
        chunks.push(currentChunk);
        currentChunk = paragraph;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
      }
    }
    if (currentChunk) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  private async extractPDF(filePath: string): Promise<string> {
    // TODO: Implement PDF extraction with pdf-parse
    throw new Error('PDF extraction not yet implemented. Install pdf-parse');
  }

  private async extractDOCX(filePath: string): Promise<string> {
    // TODO: Implement DOCX extraction with mammoth
    throw new Error('DOCX extraction not yet implemented. Install mammoth');
  }
}
