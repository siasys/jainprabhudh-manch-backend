const Project = require('../../model/SanghModels/projectModel');
const Sangh = require('../../model/SanghModels/hierarchicalSanghModel');

exports.createProject = async (req, res) => {
  try {
    const {
      sanghId,
      projectName,
      projectType,
      projectArea,
      description,
      fundingType,
      beneficiary,
      organization,
      hasSponsor,
      sponsorName,
    } = req.body;

    if (!sanghId) {
      return res.status(400).json({ success: false, message: "Sangh ID is required" });
    }

    // Step 1: Fetch the Sangh from frontend-provided ID
    const currentSangh = await Sangh.findById(sanghId);
    if (!currentSangh) {
      return res.status(404).json({ success: false, message: "Sangh not found" });
    }

    // Step 2: Get parent Sangh ID
    const parentSanghId = currentSangh.parentSangh;
    if (!parentSanghId) {
      return res.status(400).json({ success: false, message: "Parent Sangh not found" });
    }
    // console.log("✅ Incoming sanghId:", sanghId);
    // console.log("✅ currentSangh:", currentSangh);
    // console.log("✅ parentSanghId:", currentSangh.parentSangh);

    // Step 3: Create Project
    const project = new Project({
      projectName,
      projectType,
      projectArea,
      description,
      fundingType,
      beneficiary,
      organization,
      hasSponsor,
      sponsorName,
      status: 'pending',               // Default status
      assignedToSangh: parentSanghId,
      sanghId,
      createdBy: req.user._id
    });

    const saved = await project.save();

    res.status(201).json({ success: true, data: saved });

  } catch (error) {
    console.error("❌ Create Project Error:", error.message);
    res.status(500).json({ success: false, message: "Failed to create project" });
  }
};

// Get All Projects
exports.getAllProjects = async (req, res) => {
  try {
    const projects = await Project.find().populate('createdBy', 'name email');
    res.status(200).json({ success: true, data: projects });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch projects' });
  }
};

// Get Project by ID
exports.getProjectById = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id).populate('createdBy', 'name email');

    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    res.status(200).json({ success: true, data: project });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching project' });
  }
};

// Get Projects by Sangh ID
exports.getProjectsBySanghId = async (req, res) => {
  try {
    const { sanghId } = req.params;

    if (!sanghId) {
      return res.status(400).json({ success: false, message: 'Sangh ID is required' });
    }

    const projects = await Project.find({ sanghId })
      .populate('createdBy', 'name email')
      .populate('sanghId', 'name');

    if (!projects || projects.length === 0) {
      return res.status(404).json({ success: false, message: 'No projects found for this Sangh' });
    }

    res.status(200).json({ success: true, data: projects });
  } catch (error) {
    console.error("❌ Error in getProjectsBySanghId:", error);
    res.status(500).json({ success: false, message: 'Error fetching projects' });
  }
};



// Update Project
exports.updateProject = async (req, res) => {
  try {
    const updated = await Project.findByIdAndUpdate(req.params.id, req.body, { new: true });

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Update failed' });
  }
};

// Delete Project
exports.deleteProject = async (req, res) => {
  try {
    const deleted = await Project.findByIdAndDelete(req.params.id);

    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    res.status(200).json({ success: true, message: 'Project deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Deletion failed' });
  }
};
