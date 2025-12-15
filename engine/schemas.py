from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum
import blake3

class MemoryVisibility(str, Enum):
    PRIVATE = "private"
    SHARED = "shared"
    SYSTEM = "system"

class MemoryStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    ARCHIVED = "archived"

class MemoryEntry(BaseModel):
    """Core memory entry schema"""
    id: str = Field(default_factory=lambda: blake3.blake3(str(datetime.now().timestamp()).encode()).hexdigest()[:32])
    agent_id: str  # Core, Scribe, Aegis, Nyx, DevCon, etc.
    via: Optional[str] = None  # Nyx, Gateway, Unified, etc.
    namespace: str = "alsania"  # alsania, echo, aed, unified, chronicle, system
    visibility: MemoryVisibility = MemoryVisibility.PRIVATE
    status: MemoryStatus = MemoryStatus.APPROVED  # For shared memory: pending/approved/rejected
    
    text: str  # Canonical compressed memory snippet
    summary: Optional[str] = None  # Short version for prompts
    
    tags: List[str] = Field(default_factory=list)  # ["task", "project:aed", "chain:alsania", "agent:core"]
    embedding: Optional[List[float]] = None  # Vector embedding
    
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    version_thread: Optional[str] = None  # Commit hash / project version link
    source: str = "conversation"  # conversation, file, snapshot, manual, etc.
    
    # Metadata
    priority: float = 1.0  # 0.0-2.0
    salience: float = 1.0  # 0.0-1.0, relevance score
    score: Optional[float] = None  # Search relevance score
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }

class MemorySearchResult(BaseModel):
    entry: MemoryEntry
    similarity: float  # 0.0-1.0
    context: Optional[str] = None  # Additional context

class GraphNode(BaseModel):
    node_id: str
    type: str  # "person", "agent", "project", "task", "concept"
    label: str
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.now)

class GraphEdge(BaseModel):
    edge_id: str
    src_node_id: str
    dst_node_id: str
    relation: str  # "part_of", "depends_on", "updated_from", "assigned_to"
    weight: float = 1.0
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.now)

class SnapshotDescriptor(BaseModel):
    snapshot_id: str
    namespace: str
    agent_id: Optional[str] = None
    tag: str
    created_at: datetime = Field(default_factory=datetime.now)
    entry_count: int = 0
    file_path: str
    hash: Optional[str] = None

class ModerationItem(BaseModel):
    entry_id: str
    agent_id: str
    namespace: str
    text: str
    summary: Optional[str] = None
    tags: List[str]
    submitted_at: datetime
    status: MemoryStatus = MemoryStatus.PENDING
    moderated_by: Optional[str] = None
    moderated_at: Optional[datetime] = None
    reason: Optional[str] = None
