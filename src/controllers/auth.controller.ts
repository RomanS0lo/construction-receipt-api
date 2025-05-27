import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../index';

export const register = async (req: Request, res: Response) => {
  try {
    const { email, password, firstName, lastName, companyName } = req.body;
    
    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });
    
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create company and user
    const company = await prisma.company.create({
      data: {
        name: companyName,
        email,
        users: {
          create: {
            email,
            password: hashedPassword,
            firstName,
            lastName,
            role: 'ADMIN'
          }
        }
      },
      include: {
        users: true
      }
    });
    
    const user = company.users[0];
    
    // Generate token
    const token = jwt.sign(
      {
        userId: user.id,
        companyId: company.id,
        role: user.role
      },
      process.env.JWT_SECRET as string,
      { expiresIn: process.env.JWT_EXPIRE }
    );
    
    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role
      },
      company: {
        id: company.id,
        name: company.name
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    
    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
      include: { company: true }
    });
    
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() }
    });
    
    // Generate token
    const token = jwt.sign(
      {
        userId: user.id,
        companyId: user.companyId,
        role: user.role
      },
      process.env.JWT_SECRET as string,
      { expiresIn: process.env.JWT_EXPIRE }
    );
    
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role
      },
      company: {
        id: user.company.id,
        name: user.company.name
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};