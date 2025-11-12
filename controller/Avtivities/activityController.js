const Activity = require("../../model/Activity/Activity");
const HierarchicalSangh = require("../../model/SanghModels/sanghModel");
const User = require("../../model/UserRegistrationModels/userModel");
const { convertS3UrlToCDN } = require('../../utils/s3Utils');

// 🟢 Create new activity
exports.createActivity = async (req, res) => {
  try {
    const {
      sanghId,
      organizedBy,
      activityName,
      sponsors,
      judges,
      deadline,
      priceDistribution,
      shortDescription,
      rules,
    } = req.body;

    // ✅ Validate required fields
    if (!activityName || !organizedBy || !sanghId) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields (activityName, organizedBy, sanghId)",
      });
    }

    // ✅ Create new activity
    const newActivity = new Activity({
      createdBy: req.user._id,
      sanghId,
      organizedBy,
      activityName,
      sponsors,
      judges, // this will be array of { judgeLabel, userId }
      deadline,
      priceDistribution,
      shortDescription,
      rules,
    });

    await newActivity.save();

    // ✅ Update each judge’s record to include this activity
    if (Array.isArray(judges) && judges.length > 0) {
      await Promise.all(
        judges.map(async (judgeObj) => {
          // judgeObj must be in the form: { judgeLabel: "judge1", userId: "..." }
          if (judgeObj?.userId) {
            await User.findByIdAndUpdate(
              judgeObj.userId,
              {
                $addToSet: {
                  activityJudge: {
                    activityId: newActivity._id,
                    role: judgeObj.judgeLabel || "judge",
                  },
                },
              },
              { new: true }
            );
          }
        })
      );
    }

    // ✅ Success response
    res.status(201).json({
      success: true,
      message: "Activity created successfully and judges updated.",
      activity: newActivity,
    });
  } catch (error) {
    console.error("❌ Create Activity Error:", error);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};


// Get all activities (optionally filter by Sangh)
exports.getAllActivities = async (req, res) => {
  try {
    const { sanghId } = req.query;

    const filter = sanghId ? { sanghId } : {};

    const activities = await Activity.find(filter)
      .populate("createdBy", "name email fullName phoneNumber")
      .populate("sanghId", "name level")
      .populate("organizedBy", "name level")
       .populate("sponsors")
      .populate("judges", "name email fullName phoneNumber");

    res.status(200).json({
      success: true,
      count: activities.length,
      activities,
    });
  } catch (error) {
    console.error("Get All Activities Error:", error);
    res.status(500).json({ success: false, message: "Server Error", error });
  }
};

// 🔵 Get Activity by ID with winners populated
exports.getActivityById = async (req, res) => {
  try {
    const { id } = req.params;

    // Step 1️⃣: Find activity and populate related fields
    const activity = await Activity.findById(id)
      .populate("createdBy", "name email fullName phoneNumber")
      .populate("sanghId", "name level")
      .populate("organizedBy", "name level")
      .populate("participants.userId", "fullName profilePicture phoneNumber")
      .populate("judges.userId", "fullName email phoneNumber profilePicture");

    if (!activity) {
      return res
        .status(404)
        .json({ success: false, message: "Activity not found" });
    }

    // Step 2️⃣: Manually populate winner user details
    const populateUser = async (userId) => {
      if (!userId) return null;
      const user = await User.findById(userId).select(
        "fullName profilePicture phoneNumber"
      );
      return user;
    };

    const winners = {
      firstWinner: activity.winners?.firstWinner
        ? {
            ...activity.winners.firstWinner,
            userId: await populateUser(activity.winners.firstWinner.userId),
          }
        : null,
      secondWinner: activity.winners?.secondWinner
        ? {
            ...activity.winners.secondWinner,
            userId: await populateUser(activity.winners.secondWinner.userId),
          }
        : null,
      thirdWinner: activity.winners?.thirdWinner
        ? {
            ...activity.winners.thirdWinner,
            userId: await populateUser(activity.winners.thirdWinner.userId),
          }
        : null,
    };

    // Step 3️⃣: Merge updated winners in response
    const updatedActivity = {
      ...activity.toObject(),
      winners,
    };

    res.status(200).json({
      success: true,
      activity: updatedActivity,
    });
  } catch (error) {
    console.error("❌ Get Activity By ID Error:", error);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};

// ✅ Participate in Activity + Upload Activity File
exports.participateInActivity = async (req, res) => {
  try {
    const { activityId } = req.params;
    const { fullName, phoneNumber, state, district, city } = req.body;
    const userId = req.user._id;

    // ✅ Check if activity exists
    const activity = await Activity.findById(activityId);
    if (!activity) {
      return res.status(404).json({ success: false, message: "Activity not found" });
    }

    // ✅ Handle uploaded files (image/pdf)
    const uploadedFiles = (req.files?.uploadActivity || []).map((file) => ({
      fileUrl: convertS3UrlToCDN(file.location),
      fileType: file.mimetype,
      uploadedAt: new Date(),
    }));

    // ✅ Check if user already participated
    const existingParticipant = activity.participants.find(
      (p) => p.userId.toString() === userId.toString()
    );

    if (existingParticipant) {
      // 🔹 If participant already exists, update uploads
      if (uploadedFiles.length > 0) {
        existingParticipant.uploadActivity = [
          ...(existingParticipant.uploadActivity || []),
          ...uploadedFiles,
        ];
      }

      // 🔹 Update participant details if provided
      existingParticipant.fullName = fullName || existingParticipant.fullName;
      existingParticipant.phoneNumber = phoneNumber || existingParticipant.phoneNumber;
      existingParticipant.state = state || existingParticipant.state;
      existingParticipant.district = district || existingParticipant.district;
      existingParticipant.city = city || existingParticipant.city;
    } else {
      // 🔹 Add new participant
      const newParticipant = {
        userId,
        fullName,
        phoneNumber,
        state,
        district,
        city,
        uploadActivity: uploadedFiles,
      };
      activity.participants.push(newParticipant);
    }

    await activity.save();

    res.status(200).json({
      success: true,
      message: existingParticipant
        ? "Participant updated successfully."
        : "Participant added successfully.",
      activity,
    });
  } catch (error) {
    console.error("❌ participateInActivity Error:", error);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};
// Submit or Update Judge Marks
exports.submitJudgeMarks = async (req, res) => {
  try {
    const { activityId } = req.params;
    const { participantId, marks } = req.body;
    const userId = req.user._id;

    // ✅ Validate input
    if (!participantId || marks === undefined) {
      return res.status(400).json({ success: false, message: "participantId and marks are required" });
    }

    // ✅ Fetch activity
    const activity = await Activity.findById(activityId);
    if (!activity) {
      return res.status(404).json({ success: false, message: "Activity not found" });
    }

    // ✅ Check if this user is a judge in this activity
    const judgeInfo = activity.judges.find(j => j.userId.toString() === userId.toString());
    if (!judgeInfo) {
      return res.status(403).json({ success: false, message: "You are not authorized to give marks for this activity" });
    }

    const judgeLabel = judgeInfo.judgeLabel.toLowerCase(); // "judge1" | "judge2" | "judge3"

    // ✅ Find the participant
    const participant = activity.participants.find(p => p._id.toString() === participantId.toString());
    if (!participant) {
      return res.status(404).json({ success: false, message: "Participant not found" });
    }

    // ✅ Initialize activityMarks if not present
    if (!participant.activityMarks) {
      participant.activityMarks = { judge1: 0, judge2: 0, judge3: 0, finalMarks: 0 };
    }

    // ✅ Update marks only for current judge
    if (["judge1", "judge2", "judge3"].includes(judgeLabel)) {
      participant.activityMarks[judgeLabel] = marks;
    } else {
      return res.status(400).json({ success: false, message: "Invalid judge role" });
    }

    // ✅ Optionally calculate finalMarks (average)
    const { judge1, judge2, judge3 } = participant.activityMarks;
    const scores = [judge1, judge2, judge3].filter(n => n > 0);
    const finalMarks = scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : 0;
    participant.activityMarks.finalMarks = finalMarks;

    // ✅ Save activity
    await activity.save();

    res.status(200).json({
      success: true,
      message: `${judgeLabel} marks updated successfully.`,
      participantMarks: participant.activityMarks
    });

  } catch (error) {
    console.error("❌ submitJudgeMarks Error:", error);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};
// ✅ Update Activity Marks by Judge
exports.updateActivityMarks = async (req, res) => {
  try {
    const { activityId } = req.params;
    const { marks } = req.body; // { participantId: score, ... }
    const judgeUserId = req.user._id;

    // 🔹 Find activity
    const activity = await Activity.findById(activityId);
    if (!activity) {
      return res.status(404).json({ success: false, message: "Activity not found" });
    }

    // 🔹 Find judge label (judge1/judge2/judge3)
    const judge = activity.judges.find(
      (j) => j.userId.toString() === judgeUserId.toString()
    );
    if (!judge) {
      return res.status(403).json({
        success: false,
        message: "You are not assigned as a judge for this activity",
      });
    }

    const judgeLabel = judge.judgeLabel; // e.g., "judge1"

    // 🔹 Update each participant’s marks and calculate final marks if all present
    activity.participants.forEach((participant) => {
      const givenMarks = marks[participant._id];
      if (givenMarks !== undefined && participant.activityMarks) {
        // ✅ Save the current judge’s marks
        participant.activityMarks[judgeLabel] = parseFloat(givenMarks) || 0;

        const { judge1, judge2, judge3 } = participant.activityMarks;

        // ✅ Check if all three judges have given marks
        if (
          typeof judge1 === "number" &&
          typeof judge2 === "number" &&
          typeof judge3 === "number"
        ) {
          const total = judge1 + judge2 + judge3;
          const average = total / 3;
          participant.activityMarks.finalMarks = parseFloat(average.toFixed(2));
        }
      }
    });

    await activity.save();

    res.status(200).json({
      success: true,
      message: `Marks submitted successfully by ${judgeLabel}`,
      activity,
    });
  } catch (error) {
    console.error("❌ updateActivityMarks Error:", error);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};

// Auto-select top 3 winners based on finalMarks
exports.calculateWinners = async (req, res) => {
  try {
    const { activityId } = req.params;
    const { firstWinner, secondWinner, thirdWinner } = req.body; // frontend se aayega userId

    // ✅ Fetch activity
    const activity = await Activity.findById(activityId);
    if (!activity) {
      return res.status(404).json({ success: false, message: "Activity not found" });
    }

    if (!activity.participants || activity.participants.length === 0) {
      return res.status(400).json({ success: false, message: "No participants found" });
    }

    // ✅ Update winners manually
    activity.winners = {
      firstWinner: firstWinner
        ? {
            userId: firstWinner,
            marks:
              activity.participants.find(p => p.userId.toString() === firstWinner)?.activityMarks?.finalMarks || 0,
          }
        : null,
      secondWinner: secondWinner
        ? {
            userId: secondWinner,
            marks:
              activity.participants.find(p => p.userId.toString() === secondWinner)?.activityMarks?.finalMarks || 0,
          }
        : null,
      thirdWinner: thirdWinner
        ? {
            userId: thirdWinner,
            marks:
              activity.participants.find(p => p.userId.toString() === thirdWinner)?.activityMarks?.finalMarks || 0,
          }
        : null,
    };

    await activity.save();

    res.status(200).json({
      success: true,
      message: "🏆 Winners updated manually!",
      winners: activity.winners,
    });
  } catch (error) {
    console.error("❌ calculateWinners Error:", error);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};

