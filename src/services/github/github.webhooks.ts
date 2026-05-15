import { githubApp } from './github.service';
import prisma from '../../lib/prisma';
import { syncProjectRole } from '../projects/projects.service';

githubApp.webhooks.on('installation_repositories.removed', async ({ payload }) => {
  const installationId = payload.installation.id;
  const repositoriesRemoved = payload.repositories_removed || [];

  const repoIds = repositoriesRemoved.map(repo => BigInt(repo.id));
  await prisma.project.updateMany({
    where: {
      provider: 'GITHUB',
      githubRepoId: { in: repoIds }
    },
    data: { installationId: null }
  });

  console.log(`[Webhook] Removed ${repositoriesRemoved.length} repositories from installation ${installationId}`);
});

githubApp.webhooks.on('installation.deleted', async ({ payload }) => {
  const installationId = payload.installation.id;

  await prisma.project.updateMany({
    where: { installationId },
    data: { installationId: null }
  });

  console.log(`[Webhook] Installation ${installationId} removed and associated projects disconnected.`);
});

githubApp.webhooks.on('repository', async ({ payload }) => {
  if (payload.action === 'deleted') {
    await prisma.project.updateMany({
      where: { provider: 'GITHUB', githubRepoId: BigInt(payload.repository.id) },
      data: { installationId: null }
    });

    console.log(`[Webhook] Repository ${payload.repository.id} deleted → projects disconnected`);
    return;
  }

  if (payload.action !== 'renamed' && payload.action !== 'transferred') return;

  const repo = payload.repository;
  const owner = repo.owner.login;
  const repoName = repo.name;
  const repoUrl = repo.html_url;

  await prisma.project.updateMany({
    where: { provider: 'GITHUB', githubRepoId: BigInt(repo.id) },
    data: { owner, repoName, repoUrl, name: repoName }
  });

  console.log(`[Webhook] Repository ${repo.id} (${payload.action}) → ${owner}/${repoName}`);
});

githubApp.webhooks.on('installation_repositories.added', async ({ payload }) => {
  const installationId = payload.installation.id;
  const repositoriesAdded = payload.repositories_added || [];

  if (repositoriesAdded.length === 0) return;

  await prisma.$transaction(
    repositoriesAdded.map((repo) => {
      const [owner, repoName] = repo.full_name.split('/');
      return prisma.project.updateMany({
        where: {
          provider: 'GITHUB',
          githubRepoId: BigInt(repo.id),
        },
        data: {
          installationId,
          owner,
          repoName,
          repoUrl: `https://github.com/${repo.full_name}`,
          name: repoName,
        },
      });
    })
  );

  console.log(`[Webhook] Synced ${repositoriesAdded.length} repositories for installation ${installationId}`);
});

githubApp.webhooks.on('member', async ({ payload }) => {
  if (!payload.repository?.id || !payload.member?.id) return;

  const githubRepoId = BigInt(payload.repository.id);
  const githubUserId = payload.member.id.toString();

  const user = await prisma.user.findUnique({ where: { githubId: githubUserId } });
  if (!user) return;

  const project = await prisma.project.findUnique({
    where: { provider_githubRepoId: { provider: 'GITHUB', githubRepoId } }
  });
  if (!project) return;

  if (payload.action === 'removed') {
    await prisma.projectMember.deleteMany({
      where: { projectId: project.id, userId: user.id }
    });
    console.log(`[Webhook] User ${user.id} removed from project ${project.id}`);
  } else if (payload.action === 'edited') {
    try {
      const newRole = await syncProjectRole(user.id, project.id);
      console.log(`[Webhook] Synced role for user ${user.id} in project ${project.id} -> ${newRole}`);
    } catch (e) {
      console.error(`[Webhook] Failed to sync role for user ${user.id} in project ${project.id}:`, e);
    }
  }
});


export const handleGithubWebhook = async (req: any, res: any) => {
  try {
    const payload = req.body.toString('utf8');
    await githubApp.webhooks.verifyAndReceive({
      id: req.headers['x-github-delivery'] as string,
      name: req.headers['x-github-event'] as any,
      payload,
      signature: req.headers['x-hub-signature-256'] as string,
    });
    res.status(200).send('OK');
  } catch (error: any) {
    console.error('[Webhook Error]', error.message);

    if (error instanceof AggregateError)
      res.status(500).json({ error: 'Webhook processing failed' });
    else res.status(200).json({ error: 'Webhook verification failed' });
  }
};
