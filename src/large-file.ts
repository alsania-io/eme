import fs from 'fs/promises';
import { createReadStream, statSync } from 'fs';
import readline from 'readline';

export interface FileStructure {
  path: string;
  size: number;
  lines: number;
  chars: number;
  words: number;
  recommendedChunkSize: number;
  sampleStart: string[];
  sampleEnd: string[];
}

export interface SearchResult {
  lineNumber: number;
  line: string;
  contextBefore: string[];
  contextAfter: string[];
}

export class LargeFileHandler {
  async getFileStructure(filePath: string): Promise<FileStructure> {
    const stats = await fs.stat(filePath);
    const lines = await this.countLines(filePath);
    const content = await fs.readFile(filePath, 'utf-8');
    const words = content.split(/\s+/).filter(w => w.length > 0).length;
    
    // Get samples
    const allLines = content.split('\n');
    const sampleStart = allLines.slice(0, 5);
    const sampleEnd = allLines.slice(-5);
    
    // Determine optimal chunk size based on file type
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    let recommendedChunkSize = 1000; // Default lines per chunk
    if (['json', 'csv', 'log'].includes(ext)) {
      recommendedChunkSize = 5000;
    } else if (['md', 'txt'].includes(ext)) {
      recommendedChunkSize = 2000;
    }
    
    return {
      path: filePath,
      size: stats.size,
      lines,
      chars: content.length,
      words,
      recommendedChunkSize,
      sampleStart,
      sampleEnd,
    };
  }
  
  async readChunk(
    filePath: string,
    chunkIndex: number = 0,
    linesPerChunk?: number,
    includeLineNumbers: boolean = false
  ): Promise<{ lines: string[]; startLine: number; endLine: number; totalLines: number }> {
    const totalLines = await this.countLines(filePath);
    const chunkSize = linesPerChunk || Math.ceil(totalLines / 10); // Default to 10 chunks
    const startLine = chunkIndex * chunkSize;
    const endLine = Math.min(startLine + chunkSize, totalLines);
    
    const lines = await this.readLines(filePath, startLine, endLine);
    
    if (includeLineNumbers) {
      const numberedLines = lines.map((line, i) => `${startLine + i + 1}: ${line}`);
      return { lines: numberedLines, startLine, endLine, totalLines };
    }
    
    return { lines, startLine, endLine, totalLines };
  }
  
  async searchInFile(
    filePath: string,
    pattern: string,
    caseSensitive: boolean = false,
    regex: boolean = false,
    maxResults: number = 100,
    contextBefore: number = 2,
    contextAfter: number = 2,
    startLine?: number,
    endLine?: number
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    let searchPattern: RegExp;
    
    try {
      if (regex) {
        searchPattern = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
      } else {
        searchPattern = new RegExp(
          pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          caseSensitive ? 'g' : 'gi'
        );
      }
    } catch (error) {
      throw new Error(`Invalid pattern: ${error}`);
    }
    
    const fileStream = createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });
    
    let lineNumber = 0;
    const allLines: string[] = [];
    
    for await (const line of rl) {
      lineNumber++;
      
      if (startLine && lineNumber < startLine) continue;
      if (endLine && lineNumber > endLine) break;
      
      allLines.push(line);
      
      if (searchPattern.test(line) && results.length < maxResults) {
        const contextBeforeLines = allLines.slice(
          Math.max(0, allLines.length - contextBefore - 1),
          allLines.length - 1
        );
        const contextAfterLines: string[] = [];
        
        // Need to read ahead for context after
        // For now, we'll just capture what we have
        
        results.push({
          lineNumber,
          line,
          contextBefore: contextBeforeLines,
          contextAfter: contextAfterLines,
        });
      }
    }
    
    return results;
  }
  
  async navigateToLine(
    filePath: string,
    lineNumber: number,
    contextLines: number = 5
  ): Promise<{ targetLine: string; contextBefore: string[]; contextAfter: string[]; totalLines: number }> {
    const totalLines = await this.countLines(filePath);
    if (lineNumber < 1 || lineNumber > totalLines) {
      throw new Error(`Line number out of range. File has ${totalLines} lines`);
    }
    
    const startLine = Math.max(1, lineNumber - contextLines);
    const endLine = Math.min(totalLines, lineNumber + contextLines);
    const lines = await this.readLines(filePath, startLine - 1, endLine);
    
    const targetIndex = contextLines;
    const targetLine = lines[targetIndex];
    const contextBefore = lines.slice(0, targetIndex);
    const contextAfter = lines.slice(targetIndex + 1);
    
    return {
      targetLine,
      contextBefore,
      contextAfter,
      totalLines,
    };
  }
  
  async getFileSummary(filePath: string): Promise<{
    lines: number;
    chars: number;
    words: number;
    avgLineLength: number;
    maxLineLength: number;
    minLineLength: number;
  }> {
    const stats = await this.getFileStructure(filePath);
    const lines = await this.readLines(filePath, 0, stats.lines);
    
    let maxLineLength = 0;
    let minLineLength = Infinity;
    let totalLineLength = 0;
    
    for (const line of lines) {
      const len = line.length;
      totalLineLength += len;
      if (len > maxLineLength) maxLineLength = len;
      if (len < minLineLength) minLineLength = len;
    }
    
    return {
      lines: stats.lines,
      chars: stats.chars,
      words: stats.words,
      avgLineLength: totalLineLength / stats.lines,
      maxLineLength,
      minLineLength: minLineLength === Infinity ? 0 : minLineLength,
    };
  }
  
  async streamFile(
    filePath: string,
    chunkSize: number = 64 * 1024,
    startOffset: number = 0,
    maxBytes?: number,
    maxChunks: number = 10
  ): Promise<{ chunks: Buffer[]; totalBytesRead: number; hasMore: boolean }> {
    const stats = await fs.stat(filePath);
    const fileHandle = await fs.open(filePath, 'r');
    const chunks: Buffer[] = [];
    let bytesRead = 0;
    let currentOffset = startOffset;
    let chunksRead = 0;
    
    try {
      while (chunksRead < maxChunks) {
        if (maxBytes && bytesRead >= maxBytes) break;
        if (currentOffset >= stats.size) break;
        
        const remainingBytes = maxBytes ? Math.min(chunkSize, maxBytes - bytesRead) : chunkSize;
        const buffer = Buffer.alloc(remainingBytes);
        const { bytesRead: read } = await fileHandle.read(buffer, 0, remainingBytes, currentOffset);
        
        if (read === 0) break;
        
        chunks.push(buffer.slice(0, read));
        bytesRead += read;
        currentOffset += read;
        chunksRead++;
      }
    } finally {
      await fileHandle.close();
    }
    
    return {
      chunks,
      totalBytesRead: bytesRead,
      hasMore: currentOffset < stats.size,
    };
  }
  
  private async countLines(filePath: string): Promise<number> {
    const stats = await fs.stat(filePath);
    if (stats.size === 0) return 0;
    
    let lines = 0;
    const fileStream = createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });
    
    for await (const _ of rl) {
      lines++;
    }
    
    return lines;
  }
  
  private async readLines(filePath: string, startLine: number, endLine: number): Promise<string[]> {
    const lines: string[] = [];
    let currentLine = 0;
    
    const fileStream = createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });
    
    for await (const line of rl) {
      if (currentLine >= endLine) break;
      if (currentLine >= startLine) {
        lines.push(line);
      }
      currentLine++;
    }
    
    return lines;
  }
}
