const express = require('express');
const router = express.Router();
const { authMiddleware, isSuperAdmin } = require('../../middlewares/authMiddlewares');
const { validateSanghAccess, canCreateLowerLevelSangh, validateLocationHierarchy, checkSanghCreationPermission } = require('../../middlewares/sanghAuthMiddleware');
const { isOfficeBearer, canManageAreaSangh, canManageSpecializedSangh, canCreateSpecializedSangh } = require('../../middlewares/sanghPermissions');
const {
    createHierarchicalSangh,
    getHierarchy,
    getSanghsByLevelAndLocation,
    getChildSanghs,
    updateHierarchicalSangh,
    addSanghMember,
    removeSanghMember,
    updateMemberDetails,
    getSanghMembers,
    addMultipleSanghMembers,
    getAllSangh,
    checkOfficeBearerTerms,
    createSpecializedSangh,
    getSpecializedSanghs,
    updateSpecializedSangh,
    getAllSanghs,
    generateMemberCard,
    generateMembersCard,
    getUserByJainAadhar,
    updateSanghById,
    unfollowSangh,
    followSangh,
    switchToSanghToken,
    updateSanghDetails,
    updatePanchMembers,
    updateMemberStatus,
    deleteSanghTeamMember,
    addHonoraryMember
} = require('../../controller/SanghControllers/hierarchicalSanghController');

const upload = require('../../middlewares/upload');

router.get('/generate-member-card/:userId', generateMemberCard);
router.get('/generate-card/:userId', generateMembersCard);
// Protect all routes
router.use(authMiddleware);
router.post('/switch-sangh-token', authMiddleware, switchToSanghToken);


// Create new Sangh (Protected + Requires ability to create lower level)
router.post('/create', upload.sangathanDocs, checkSanghCreationPermission,
    (req, res, next) => {
        if (req.user.role === 'superadmin') {
            return next();
        }
        validateLocationHierarchy(req, res, next);
    },
    createHierarchicalSangh
);
router.post('/:sanghId/follow', followSangh);
router.post('/:sanghId/unfollow', unfollowSangh);
    // Get all Sangh
    router.get('/sangh/all', getAllSangh);
  // Get all Sangh
    router.get('/all', getAllSanghs);

// Get Sangh hierarchy
router.get('/hierarchy/:id', getHierarchy
    //validateSanghAccess,
    );

// Get Sanghs by level and location
router.get('/search',
    getSanghsByLevelAndLocation
);
router.get('/user/by-jain-aadhar/:jainAadharNumber', getUserByJainAadhar);

// Get child Sanghs
router.get('/children/:id', validateSanghAccess, getChildSanghs);
router.put('/update-sangh/:id', upload.sangathanDocs, updateSanghById);
router.put('/update-sangh-details/:sanghId', updateSanghDetails);
router.put('/update-panch-members/:sanghId', updatePanchMembers);
// routes/hierarchicalSanghRoutes.js
router.patch('/member-status', updateMemberStatus);

// Update Sangh (Requires office bearer permission)
router.put('/update/:id', upload.sangathanDocs, updateHierarchicalSangh);

// Member management routes with updated permissions
router.post('/:sanghId/members', upload.memberUploads, addSanghMember);
router.post('/:sanghId/honorary-member', upload.memberUploads, addHonoraryMember);

router.delete('/:sanghId/sangh-team/:memberId', deleteSanghTeamMember);
router.delete('/:sanghId/members/:memberId', isOfficeBearer,
    //validateSanghAccess,
    removeSanghMember);

router.put('/:sanghId/members/:memberId', upload.memberUploads, updateMemberDetails);

router.get('/:sanghId/members', 
    validateSanghAccess,
    getSanghMembers
);
router.get('/:sanghId/check-terms', 
    authMiddleware,
    checkOfficeBearerTerms
);
// Area-specific routes
router.put('/area/:sanghId', 
    authMiddleware,
    canManageAreaSangh,
    updateHierarchicalSangh
);
// router.post('/area/:sanghId/members',
//     authMiddleware,
//     canManageAreaSangh,
//     upload.memberPhoto,
//     addSanghMember
// );
router.delete('/area/:sanghId/members/:memberId',
    authMiddleware,
    canManageAreaSangh,
    removeSanghMember
);
// Create specialized Sangh (Women/Youth) - For both main Sangh presidents and specialized Sangh presidents
router.post('/create-specialized-sangh',
 // authMiddleware,
    upload.sangathanDocs,
  canCreateSpecializedSangh,
    createSpecializedSangh
);

// Get specialized Sanghs for a main Sangh
router.get('/:sanghId/specialized-sanghs',
    validateSanghAccess,
    getSpecializedSanghs
);

// Update specialized Sangh - Accessible by both specialized Sangh president and parent main Sangh president
router.put('/specialized/:sanghId',
    authMiddleware,
    canManageSpecializedSangh,
    upload.sangathanDocs,
    updateSpecializedSangh
);

// Specialized Sangh member management routes
router.post('/specialized/:sanghId/members',
    authMiddleware,
    canManageSpecializedSangh,
    upload.fields([
        { name: 'memberJainAadhar', maxCount: 1 },
        { name: 'memberPhoto', maxCount: 1 }
    ]),
    addSanghMember
);

router.post('/specialized/:sanghId/members/bulk',
    authMiddleware,
    canManageSpecializedSangh,
    addMultipleSanghMembers
);

router.delete('/specialized/:sanghId/members/:memberId',
    authMiddleware,
    canManageSpecializedSangh,
    removeSanghMember
);

// Add route for updating member details in specialized Sanghs
router.put('/specialized/:sanghId/members/:memberId',
    authMiddleware,
    canManageSpecializedSangh,
    upload.fields([
        { name: 'memberJainAadhar', maxCount: 1 },
        { name: 'memberPhoto', maxCount: 1 }
    ]),
    updateMemberDetails
);
module.exports = router;