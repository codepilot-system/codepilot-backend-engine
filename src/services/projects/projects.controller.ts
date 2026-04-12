import { Request, Response } from 'express';

export const getProjects = async (req: Request, res: Response) => {
  res.status(200).json({
    status: "success",
    data: [{
      id: 101,
      name: "sample-project",
      repoUrl: "https://github.com/user/sample-project",
      provider: "github"
    }]
  });
};

export const connectProject = async (req: Request, res: Response) => {
  const { repoUrl, name } = req.body;
  res.status(201).json({
    status: "success",
    data: { 
      id: 102, 
      name: name || "new-project", 
      repoUrl: repoUrl || "https://github.com/user/new-project",
      provider: "github" 
    }
  });
};

export const getProjectById = async (req: Request, res: Response) => {
  const { projectId } = req.params;
  res.status(200).json({
    status: "success",
    data: {
      id: parseInt(projectId as string),
      name: "sample-project",
      repoUrl: "https://github.com/user/sample-project",
      provider: "github"
    }
  });
};

export const updateProject = async (req: Request, res: Response) => {
  const { projectId } = req.params;
  res.status(200).json({
    status: "success",
    data: { 
      id: parseInt(projectId as string), 
      name: req.body.name || "updated-name",
      repoUrl: "https://github.com/user/sample-project",
      provider: "github"
    }
  });
};

export const deleteProject = async (req: Request, res: Response) => {
  res.status(200).json({
    status: "success",
    message: "Project disconnected successfully"
  });
};

export const getProjectMembers = async (req: Request, res: Response) => {
  res.status(200).json({
    status: "success",
    data: [{ userId: 1, username: "owner", role: "OWNER" }]
  });
};
