import express from "express";
import { ApiError, asyncHandler } from "./errors.js";
import { findUserJobById, listUserJobs, publicPersistentJob } from "./jobRepository.js";

export const jobRouter = express.Router();

jobRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const jobs = await listUserJobs({
      userId: req.user.id,
      limit: req.query.limit
    });

    res.json({
      ok: true,
      jobs: jobs.map(publicPersistentJob)
    });
  })
);

jobRouter.get(
  "/:jobId",
  asyncHandler(async (req, res) => {
    const job = await findUserJobById({
      userId: req.user.id,
      jobId: req.params.jobId
    });

    if (!job) {
      throw new ApiError(404, "Job not found.", { jobId: req.params.jobId });
    }

    res.json({ ok: true, job: publicPersistentJob(job) });
  })
);