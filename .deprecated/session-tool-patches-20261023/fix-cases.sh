#!/bin/bash
FILE="src/mcp-server.ts"

# Fix create_snapshot
sed -i 's/case "create_snapshot": { const snapshot = await this.memoryManager.createSnapshot(args.name, args.type, args.description);/case "create_snapshot": { const parsed = CreateSnapshotSchema.parse(args); const snapshot = await this.memoryManager.createSnapshot(parsed.name, parsed.type, parsed.description);/' "$FILE"

# Fix list_snapshots
sed -i 's/case "list_snapshots": { const snapshots = await this.memoryManager.listSnapshots(args.type);/case "list_snapshots": { const parsed = ListSnapshotsSchema.parse(args); const snapshots = await this.memoryManager.listSnapshots(parsed.type);/' "$FILE"

# Fix load_snapshot
sed -i 's/case "load_snapshot": { const snapshot = await this.memoryManager.loadSnapshot(args.id);/case "load_snapshot": { const parsed = LoadSnapshotSchema.parse(args); const snapshot = await this.memoryManager.loadSnapshot(parsed.id);/' "$FILE"

# Fix delete_snapshot
sed -i 's/case "delete_snapshot": { await this.memoryManager.deleteSnapshot(args.id);/case "delete_snapshot": { const parsed = DeleteSnapshotSchema.parse(args); await this.memoryManager.deleteSnapshot(parsed.id);/' "$FILE"

# Fix search_nodes
sed -i 's/case "search_nodes": { const results = await this.memoryManager.searchNodes(args.query);/case "search_nodes": { const parsed = z.object({ query: z.string() }).parse(args); const results = await this.memoryManager.searchNodes(parsed.query);/' "$FILE"

# Fix open_nodes
sed -i 's/case "open_nodes": { const results = await this.memoryManager.openNodes(args.names);/case "open_nodes": { const parsed = OpenNodesSchema.parse(args); const results = await this.memoryManager.openNodes(parsed.names);/' "$FILE"

# Fix query_documents
sed -i 's/case "query_documents": { const results = await this.localRAG!.queryDocuments(args.query, args.limit);/case "query_documents": { const parsed = QueryDocumentsSchema.parse(args); const results = await this.localRAG!.queryDocuments(parsed.query, parsed.limit);/' "$FILE"

# Fix ingest_file
sed -i 's/case "ingest_file": { const result = await this.localRAG!.ingestFile(args.filePath);/case "ingest_file": { const parsed = IngestFileSchema.parse(args); const result = await this.localRAG!.ingestFile(parsed.filePath);/' "$FILE"

# Fix ingest_data
sed -i 's/case "ingest_data": { const result = await this.localRAG!.ingestData(args.content, { source: args.metadata.source, format: args.metadata.format });/case "ingest_data": { const parsed = IngestDataSchema.parse(args); const result = await this.localRAG!.ingestData(parsed.content, { source: parsed.metadata.source, format: parsed.metadata.format });/' "$FILE"

# Fix delete_file
sed -i 's/case "delete_file": { const result = args.filePath ? await this.localRAG!.deleteDocument(args.filePath) : await this.localRAG!.deleteDocument(args.source);/case "delete_file": { const parsed = DeleteDocumentSchema.parse(args); const result = parsed.filePath ? await this.localRAG!.deleteDocument(parsed.filePath) : await this.localRAG!.deleteDocument(parsed.source);/' "$FILE"

# Fix read_large_file_chunk
sed -i 's/case "read_large_file_chunk": { const result = await this.largeFileHandler!.readChunk(args.filePath, args.chunkIndex, args.linesPerChunk, args.includeLineNumbers);/case "read_large_file_chunk": { const parsed = ReadLargeFileChunkSchema.parse(args); const result = await this.largeFileHandler!.readChunk(parsed.filePath, parsed.chunkIndex, parsed.linesPerChunk, parsed.includeLineNumbers);/' "$FILE"

# Fix search_in_large_file
sed -i 's/case "search_in_large_file": { const results = await this.largeFileHandler!.searchInFile(args.filePath, args.pattern, args.caseSensitive, args.regex, args.maxResults, args.contextBefore, args.contextAfter, args.startLine, args.endLine);/case "search_in_large_file": { const parsed = SearchInLargeFileSchema.parse(args); const results = await this.largeFileHandler!.searchInFile(parsed.filePath, parsed.pattern, parsed.caseSensitive, parsed.regex, parsed.maxResults, parsed.contextBefore, parsed.contextAfter, parsed.startLine, parsed.endLine);/' "$FILE"

# Fix get_file_structure
sed -i 's/case "get_file_structure": { const structure = await this.largeFileHandler!.getFileStructure(args.filePath);/case "get_file_structure": { const parsed = GetFileStructureSchema.parse(args); const structure = await this.largeFileHandler!.getFileStructure(parsed.filePath);/' "$FILE"

# Fix navigate_to_line
sed -i 's/case "navigate_to_line": { const result = await this.largeFileHandler!.navigateToLine(args.filePath, args.lineNumber, args.contextLines);/case "navigate_to_line": { const parsed = NavigateToLineSchema.parse(args); const result = await this.largeFileHandler!.navigateToLine(parsed.filePath, parsed.lineNumber, parsed.contextLines);/' "$FILE"

# Fix get_file_summary
sed -i 's/case "get_file_summary": { const summary = await this.largeFileHandler!.getFileSummary(args.filePath);/case "get_file_summary": { const parsed = GetFileSummarySchema.parse(args); const summary = await this.largeFileHandler!.getFileSummary(parsed.filePath);/' "$FILE"

# Fix stream_large_file
sed -i 's/case "stream_large_file": { const result = await this.largeFileHandler!.streamFile(args.filePath, args.chunkSize, args.startOffset, args.maxBytes, args.maxChunks);/case "stream_large_file": { const parsed = StreamLargeFileSchema.parse(args); const result = await this.largeFileHandler!.streamFile(parsed.filePath, parsed.chunkSize, parsed.startOffset, parsed.maxBytes, parsed.maxChunks);/' "$FILE"

echo "Cases fixed"
