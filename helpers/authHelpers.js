const jwt = require('jsonwebtoken');

// Normal User Token
const generateToken = (user) => {
  return jwt.sign(
    {
      _id: user._id,
      type: 'user',
      firstName: user.firstName,
      lastName: user.lastName,
      sanghRoles: user.sanghRoles || [],
      panchRoles: user.panchRoles || [],
      tirthRoles: user.tirthRoles || [],
      vyaparRoles: user.vyaparRoles || [],
      sadhuRoles: user.sadhuRoles || []
    },
    process.env.JWT_SECRET
  );
};

//  New: Sangh-specific Token
const generateSanghToken = (user, sanghId) => {
  const sanghRole = user.sanghRoles?.find(r => r.sanghId.toString() === sanghId?.toString());

  if (!sanghRole) {
    throw new Error("No sangh role found for the specified sanghId.");
  }

  return jwt.sign(
    {
      originalUserId: user._id,
      type: 'sangh',
      sanghId: sanghId,
      role: sanghRole.role,
      level: sanghRole.level,
      sanghType: sanghRole.sanghType
    },
    process.env.JWT_SECRET,
  );
};

module.exports = { generateToken, generateSanghToken };
