export type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";
export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type PresenceStatus = "ONLINE" | "AWAY" | "OFFLINE" | "WORKING";

export interface UserDTO {
  id: string;
  firstName: string;
  lastName?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
}

export interface TaskDTO {
  id: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  progress: number;
  priority: Priority;
  deadlineAt: string; // ISO
  assigneeId: string;
  creatorId: string;
  assignee: UserDTO;
  creator: UserDTO;
  completedAt?: string | null;
  createdAt: string;
  _count?: { comments: number; attachments: number };
}

export interface CommentDTO {
  id: string;
  taskId: string;
  authorId: string;
  text: string;
  createdAt: string;
  author: UserDTO;
}

export interface PresenceDTO {
  userId: string;
  status: PresenceStatus;
  workingTaskId?: string | null;
  lastSeenAt: string;
}

export interface ActivityDTO {
  id: string;
  type: string;
  actorId: string;
  taskId?: string | null;
  meta?: Record<string, unknown> | null;
  createdAt: string;
  actor?: { id: string; firstName: string };
  task?: { id: string; title: string };
}

export interface WorkspaceDTO {
  id: string;
  name: string;
  inviteToken?: string | null;
  members: { userId: string }[];
}
