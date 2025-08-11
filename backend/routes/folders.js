const express = require('express');
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');
const SSHManager = require('../config/SSHManager');

const router = express.Router();

// GET /api/folders - Lista pastas do usuário
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // Buscar pastas do usuário na tabela streamings
    const [rows] = await db.execute(
      `SELECT 
        codigo as id,
        identificacao as nome,
        codigo_servidor
       FROM streamings 
       WHERE codigo_cliente = ? AND status = 1`,
      [userId]
    );

    // Se não houver pastas, criar uma pasta padrão
    if (rows.length === 0) {
      const userEmail = req.user.email ? req.user.email.split('@')[0] : `user_${userId}`;
      res.json([{ id: 1, nome: userEmail }]);
    } else {
      res.json(rows);
    }
  } catch (err) {
    console.error('Erro ao buscar pastas:', err);
    res.status(500).json({ error: 'Erro ao buscar pastas', details: err.message });
  }
});

// POST /api/folders - Cria nova pasta
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { nome } = req.body;
    if (!nome) return res.status(400).json({ error: 'Nome da pasta é obrigatório' });
    
    const userId = req.user.id;
    const userEmail = req.user.email ? req.user.email.split('@')[0] : `user_${userId}`;
    const userLogin = userEmail;

    // Buscar servidor padrão ou do usuário
    const [userServerRows] = await db.execute(
      'SELECT codigo_servidor FROM streamings WHERE codigo_cliente = ? LIMIT 1',
      [userId]
    );

    const serverId = userServerRows.length > 0 ? userServerRows[0].codigo_servidor : 1;
    // Criar entrada na tabela streamings para representar a pasta
    const [result] = await db.execute(
      `INSERT INTO streamings (
        codigo_cliente, codigo_servidor, login, senha, senha_transmissao,
        espectadores, bitrate, espaco, ftp_dir, identificacao, email,
        data_cadastro, aplicacao, status
      ) VALUES (?, ?, ?, '', '', 100, 2500, 1000, ?, ?, ?, NOW(), 'live', 1)`,
      [userId, serverId, userLogin, `/${userLogin}/${nome}`, nome, req.user.email]
    );

    try {
      // Garantir que o diretório do usuário existe no servidor
      await SSHManager.createUserDirectory(serverId, userLogin);
      
      // Criar a pasta específica no servidor via SSH
      await SSHManager.createUserFolder(serverId, userLogin, nome);
      
      console.log(`✅ Pasta ${nome} criada no servidor para usuário ${userLogin}`);
    } catch (sshError) {
      console.error('Erro ao criar pasta no servidor:', sshError);
      // Remover entrada do banco se falhou no servidor
      await db.execute('DELETE FROM streamings WHERE codigo = ?', [result.insertId]);
      return res.status(500).json({ 
        error: 'Erro ao criar pasta no servidor',
        details: sshError.message 
      });
    }
    res.status(201).json({
      id: result.insertId,
      nome: nome
    });
  } catch (err) {
    console.error('Erro ao criar pasta:', err);
    res.status(500).json({ error: 'Erro ao criar pasta', details: err.message });
  }
});

// DELETE /api/folders/:id - Remove pasta
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const folderId = req.params.id;
    const userId = req.user.id;
    const userLogin = req.user.email.split('@')[0];

    // Verificar se a pasta pertence ao usuário
    const [folderRows] = await db.execute(
      'SELECT codigo, identificacao, codigo_servidor FROM streamings WHERE codigo = ? AND codigo_cliente = ?',
      [folderId, userId]
    );

    if (folderRows.length === 0) {
      return res.status(404).json({ error: 'Pasta não encontrada' });
    }

    const folder = folderRows[0];
    const serverId = folder.codigo_servidor || 1;
    const folderName = folder.identificacao;

    try {
      // Remover pasta e todos os vídeos do servidor via SSH
      const remoteFolderPath = `/usr/local/WowzaStreamingEngine/content/${userLogin}/${folderName}`;
      await SSHManager.executeCommand(serverId, `rm -rf "${remoteFolderPath}"`);
      console.log(`✅ Pasta ${folderName} removida do servidor`);
    } catch (sshError) {
      console.warn('Erro ao remover pasta do servidor:', sshError.message);
      return res.status(500).json({ 
        error: 'Erro ao remover pasta do servidor Wowza',
        details: sshError.message 
      });
    }
    
    // Remover todos os vídeos da pasta do banco de dados
    await db.execute(
      'DELETE FROM videos WHERE pasta = ? AND codigo_cliente = ?',
      [folderId, userId]
    );
    
    // Remover pasta do banco
    await db.execute(
      'DELETE FROM streamings WHERE codigo = ? AND codigo_cliente = ?',
      [folderId, userId]
    );

    res.json({ 
      success: true, 
      message: 'Pasta e todos os vídeos removidos com sucesso do servidor e banco de dados' 
    });
  } catch (err) {
    console.error('Erro ao remover pasta:', err);
    res.status(500).json({ error: 'Erro ao remover pasta', details: err.message });
  }
});

// PUT /api/folders/:id - Atualiza pasta
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const folderId = req.params.id;
    const { nome } = req.body;
    const userId = req.user.id;
    const userLogin = req.user.email.split('@')[0];

    if (!nome || !nome.trim()) {
      return res.status(400).json({ error: 'Nome da pasta é obrigatório' });
    if (folderRows.length === 0) {
      return res.status(404).json({ error: 'Pasta não encontrada' });
    }
    }
    const folder = folderRows[0];
    const serverId = folder.codigo_servidor || 1;
    const oldFolderName = folder.identificacao;
    const newFolderName = nome.trim();

    // Se o nome não mudou, não fazer nada
    if (oldFolderName === newFolderName) {
      return res.json({ success: true, message: 'Nome da pasta não foi alterado' });
    }
    // Verificar se a pasta pertence ao usuário
    try {
      // Renomear pasta no servidor via SSH
      const oldRemotePath = `/usr/local/WowzaStreamingEngine/content/${userLogin}/${oldFolderName}`;
      const newRemotePath = `/usr/local/WowzaStreamingEngine/content/${userLogin}/${newFolderName}`;
      
      // Verificar se pasta antiga existe
      const checkCommand = `test -d "${oldRemotePath}" && echo "EXISTS" || echo "NOT_EXISTS"`;
      const checkResult = await SSHManager.executeCommand(serverId, checkCommand);
      
      if (checkResult.stdout.includes('EXISTS')) {
        // Renomear pasta no servidor
        await SSHManager.executeCommand(serverId, `mv "${oldRemotePath}" "${newRemotePath}"`);
        console.log(`✅ Pasta renomeada no servidor: ${oldFolderName} -> ${newFolderName}`);
      } else {
        console.warn(`Pasta ${oldFolderName} não existe no servidor, criando nova`);
        await SSHManager.createUserFolder(serverId, userLogin, newFolderName);
      }
    } catch (sshError) {
      console.error('Erro ao renomear pasta no servidor:', sshError.message);
      return res.status(500).json({ 
        error: 'Erro ao renomear pasta no servidor Wowza',
        details: sshError.message 
      });
    }
    const [folderRows] = await db.execute(
    // Atualizar nome da pasta no banco
    await db.execute(
      'UPDATE streamings SET identificacao = ? WHERE codigo = ? AND codigo_cliente = ?',
      [newFolderName, folderId, userId]
    );
      'SELECT codigo, identificacao, codigo_servidor FROM streamings WHERE codigo = ? AND codigo_cliente = ?',
    // Atualizar caminhos dos vídeos no banco se necessário
    await db.execute(
      `UPDATE videos SET 
        url = REPLACE(url, ?, ?),
        caminho = REPLACE(caminho, ?, ?)
       WHERE pasta = ? AND codigo_cliente = ?`,
      [
        `/${userLogin}/${oldFolderName}/`, `/${userLogin}/${newFolderName}/`,
        `/${userLogin}/${oldFolderName}/`, `/${userLogin}/${newFolderName}/`,
        folderId, userId
      ]
    );
      [folderId, userId]
    res.json({ 
      success: true, 
      message: 'Pasta renomeada com sucesso no servidor e banco de dados',
      old_name: oldFolderName,
      new_name: newFolderName
    });
  } catch (err) {
    console.error('Erro ao atualizar pasta:', err);
    res.status(500).json({ error: 'Erro ao atualizar pasta', details: err.message });
  }
});
    );
module.exports = router;