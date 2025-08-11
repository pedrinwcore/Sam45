import React, { useState, useEffect } from 'react';
import { ChevronLeft, Upload, Play, Trash2, FolderPlus, Eye, RefreshCw, HardDrive, AlertCircle, CheckCircle, X, Edit2, ChevronDown, ChevronRight, Folder, Video, Save, ExternalLink, Zap, Settings, FolderEdit, FolderX } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useAuth } from '../../context/AuthContext';

interface Folder {
  id: number;
  nome: string;
}

interface Video {
  id: number;
  nome: string;
  url: string;
  duracao?: number;
  tamanho?: number;
  bitrate_video?: number;
  formato_original?: string;
  is_mp4?: boolean;
  user_bitrate_limit?: number;
  bitrate_exceeds_limit?: boolean;
  format_incompatible?: boolean;
  folder?: string;
  user?: string;
}

interface FolderUsage {
  used: number;
  total: number;
  percentage: number;
  available: number;
}

interface UploadProgress {
  fileName: string;
  progress: number;
  status: 'uploading' | 'processing' | 'completed' | 'error';
  error?: string;
  size?: number;
  uploadedSize?: number;
}

const GerenciarVideos: React.FC = () => {
  const { getToken, user } = useAuth();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [videosByFolder, setVideosByFolder] = useState<Record<number, Video[]>>({});
  const [expandedFolders, setExpandedFolders] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [folderUsages, setFolderUsages] = useState<Record<number, FolderUsage>>({});
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);
  const [showUploadModal, setShowUploadModal] = useState(false);
  
  // Player modal state - player simples
  const [showPlayerModal, setShowPlayerModal] = useState(false);
  const [currentVideo, setCurrentVideo] = useState<Video | null>(null);

  // Edit video state
  const [editingVideo, setEditingVideo] = useState<{ id: number; nome: string } | null>(null);
  const [newVideoName, setNewVideoName] = useState('');

  // Edit folder state
  const [editingFolder, setEditingFolder] = useState<{ id: number; nome: string } | null>(null);
  const [showDeleteFolderModal, setShowDeleteFolderModal] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState<Folder | null>(null);

  useEffect(() => {
    loadFolders();
  }, []);

  const loadFolders = async () => {
    try {
      const token = await getToken();
      const response = await fetch('/api/folders', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      setFolders(data);
      
      // Expandir primeira pasta por padrão
      if (data.length > 0) {
        setExpandedFolders({ [data[0].id]: true });
        await loadVideosForFolder(data[0].id);
        await loadFolderUsage(data[0].id);
      }
    } catch (error) {
      toast.error('Erro ao carregar pastas');
    }
  };

  const loadVideosForFolder = async (folderId: number) => {
    try {
      const token = await getToken();
      const response = await fetch(`/api/videos?folder_id=${folderId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      setVideosByFolder(prev => ({
        ...prev,
        [folderId]: Array.isArray(data) ? data : []
      }));
    } catch (error) {
      console.error(`Erro ao carregar vídeos da pasta ${folderId}:`, error);
      setVideosByFolder(prev => ({
        ...prev,
        [folderId]: []
      }));
    }
  };

  const loadFolderUsage = async (folderId: number) => {
    try {
      const token = await getToken();
      const response = await fetch(`/api/videos-ssh/folders/${folderId}/usage`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setFolderUsages(prev => ({
            ...prev,
            [folderId]: data.usage
          }));
        }
      }
    } catch (error) {
      console.error(`Erro ao carregar uso da pasta ${folderId}:`, error);
    }
  };

  const toggleFolder = async (folderId: number) => {
    const isCurrentlyExpanded = expandedFolders[folderId];
    
    setExpandedFolders(prev => ({
      ...prev,
      [folderId]: !prev[folderId]
    }));

    // Se está expandindo, carregar vídeos
    if (!isCurrentlyExpanded) {
      await loadVideosForFolder(folderId);
      await loadFolderUsage(folderId);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>, folderId: number) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Verificar se é um arquivo de vídeo
    const videoExtensions = [
      '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv',
      '.3gp', '.3g2', '.ts', '.mpg', '.mpeg', '.ogv', '.m4v', '.asf'
    ];
    const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    
    if (!videoExtensions.includes(fileExtension)) {
      toast.error(`Formato não suportado: ${fileExtension}. Use: ${videoExtensions.join(', ')}`);
      return;
    }

    // Verificar tamanho do arquivo
    const fileSizeMB = Math.ceil(file.size / (1024 * 1024));
    const folderUsage = folderUsages[folderId];
    if (folderUsage && fileSizeMB > folderUsage.available) {
      toast.error(`Arquivo muito grande! Tamanho: ${fileSizeMB}MB, Disponível: ${folderUsage.available}MB`);
      return;
    }

    setUploading(true);
    setShowUploadModal(true);
    
    // Inicializar progresso
    const initialProgress: UploadProgress = {
      fileName: file.name,
      progress: 0,
      status: 'uploading',
      size: file.size,
      uploadedSize: 0
    };
    setUploadProgress([initialProgress]);

    try {
      const token = await getToken();
      const formData = new FormData();
      formData.append('video', file);
      formData.append('duracao', '0');
      formData.append('tamanho', file.size.toString());

      // Criar XMLHttpRequest para monitorar progresso
      const xhr = new XMLHttpRequest();
      
      // Monitorar progresso do upload
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percentComplete = Math.round((e.loaded / e.total) * 100);
          setUploadProgress([{
            ...initialProgress,
            progress: percentComplete,
            uploadedSize: e.loaded,
            status: percentComplete === 100 ? 'processing' : 'uploading'
          }]);
        }
      });

      // Configurar requisição
      xhr.open('POST', `/api/videos/upload?folder_id=${folderId}`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      
      // Tratar resposta
      xhr.onload = async () => {
        if (xhr.status === 201) {
          const result = JSON.parse(xhr.responseText);
          setUploadProgress([{
            ...initialProgress,
            progress: 100,
            status: 'completed'
          }]);
          
          toast.success(`Vídeo "${result.nome}" enviado com sucesso!`);
          await loadVideosForFolder(folderId);
          await loadFolderUsage(folderId);
          
          // Reset input
          event.target.value = '';
          
          // Fechar modal após 2 segundos
          setTimeout(() => {
            setShowUploadModal(false);
            setUploadProgress([]);
          }, 2000);
        } else {
          const errorData = JSON.parse(xhr.responseText);
          setUploadProgress([{
            ...initialProgress,
            status: 'error',
            error: errorData.error || 'Erro no upload'
          }]);
          toast.error(errorData.error || 'Erro no upload');
        }
      };
      
      xhr.onerror = () => {
        setUploadProgress([{
          ...initialProgress,
          status: 'error',
          error: 'Erro de conexão durante o upload'
        }]);
        toast.error('Erro de conexão durante o upload');
      };
      
      // Enviar arquivo
      xhr.send(formData);
      
    } catch (error) {
      console.error('Erro no upload:', error);
      setUploadProgress([{
        ...initialProgress,
        status: 'error',
        error: 'Erro inesperado durante o upload'
      }]);
      toast.error('Erro no upload do vídeo');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteVideo = async (videoId: number, videoName: string, folderId: number) => {
    if (!confirm(`Deseja realmente excluir o vídeo "${videoName}"?`)) return;

    try {
      const token = await getToken();
      const response = await fetch(`/api/videos/${videoId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        toast.success('Vídeo excluído com sucesso!');
        await loadVideosForFolder(folderId);
        await loadFolderUsage(folderId);
      } else {
        const errorData = await response.json();
        toast.error(errorData.error || 'Erro ao excluir vídeo');
      }
    } catch (error) {
      toast.error('Erro ao excluir vídeo');
    }
  };

  const handleEditVideo = (video: Video) => {
    setEditingVideo({ id: video.id, nome: video.nome });
    setNewVideoName(video.nome);
  };

  const saveVideoName = async () => {
    if (!editingVideo || !newVideoName.trim()) return;

    try {
      const token = await getToken();
      const videoId = Buffer.from(editingVideo.id.toString()).toString('base64');
      
      const response = await fetch(`/api/videos-ssh/${videoId}/rename`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ novo_nome: newVideoName.trim() })
      });

      if (response.ok) {
        toast.success('Nome do vídeo atualizado com sucesso!');
        setEditingVideo(null);
        setNewVideoName('');
        // Recarregar vídeos de todas as pastas expandidas
        for (const folder of folders) {
          if (expandedFolders[folder.id]) {
            await loadVideosForFolder(folder.id);
          }
        }
      } else {
        const errorData = await response.json();
        toast.error(errorData.error || 'Erro ao renomear vídeo');
      }
    } catch (error) {
      console.error('Erro ao renomear vídeo:', error);
      toast.error('Erro ao renomear vídeo');
    }
  };

  const cancelEdit = () => {
    setEditingVideo(null);
    setNewVideoName('');
  };

  const handleEditFolder = (folder: Folder) => {
    setEditingFolder({ id: folder.id, nome: folder.nome });
    setNewFolderName(folder.nome);
  };

  const saveFolderName = async () => {
    if (!editingFolder || !newFolderName.trim()) return;

    try {
      const token = await getToken();
      const response = await fetch(`/api/folders/${editingFolder.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ nome: newFolderName.trim() })
      });

      if (response.ok) {
        toast.success('Nome da pasta atualizado com sucesso!');
        setEditingFolder(null);
        setNewFolderName('');
        loadFolders();
      } else {
        const errorData = await response.json();
        toast.error(errorData.error || 'Erro ao renomear pasta');
      }
    } catch (error) {
      console.error('Erro ao renomear pasta:', error);
      toast.error('Erro ao renomear pasta');
    }
  };

  const cancelFolderEdit = () => {
    setEditingFolder(null);
    setNewFolderName('');
  };

  const confirmDeleteFolder = (folder: Folder) => {
    setFolderToDelete(folder);
    setShowDeleteFolderModal(true);
  };

  const handleDeleteFolder = async () => {
    if (!folderToDelete) return;

    try {
      const token = await getToken();
      const response = await fetch(`/api/folders/${folderToDelete.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        toast.success('Pasta excluída com sucesso!');
        setShowDeleteFolderModal(false);
        setFolderToDelete(null);
        loadFolders();
      } else {
        const errorData = await response.json();
        toast.error(errorData.error || 'Erro ao excluir pasta');
      }
    } catch (error) {
      console.error('Erro ao excluir pasta:', error);
      toast.error('Erro ao excluir pasta');
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      toast.error('Nome da pasta é obrigatório');
      return;
    }

    try {
      const token = await getToken();
      const response = await fetch('/api/folders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ nome: newFolderName })
      });

      if (response.ok) {
        const result = await response.json();
        toast.success('Pasta criada com sucesso!');
        setShowNewFolderModal(false);
        setNewFolderName('');
        loadFolders();
      } else {
        const errorData = await response.json();
        toast.error(errorData.error || 'Erro ao criar pasta');
      }
    } catch (error) {
      toast.error('Erro ao criar pasta');
    }
  };

  const openVideoPlayer = (video: Video) => {
    setCurrentVideo(video);
    setShowPlayerModal(true);
  };

  const closeVideoPlayer = () => {
    setShowPlayerModal(false);
    setCurrentVideo(null);
  };

  const buildVideoUrl = (url: string) => {
    if (!url) return '';
    
    // Construir URL correta para vídeos no servidor do cliente
    const userLogin = user?.email?.split('@')[0] || 'usuario';
    
    // Se é um caminho relativo, construir URL completa
    if (!url.startsWith('http') && !url.includes('/api/videos-ssh/')) {
      // Extrair informações do caminho
      const cleanPath = url.replace(/^\/+/, '');
      const pathParts = cleanPath.split('/');
      
      // Se o caminho já tem o formato correto (usuario/pasta/arquivo)
      if (pathParts.length >= 3) {
        const fileName = pathParts[pathParts.length - 1];
        const folderName = pathParts[pathParts.length - 2];
        
        // Garantir que é MP4
        const mp4FileName = fileName.endsWith('.mp4') ? fileName : fileName.replace(/\.[^/.]+$/, '.mp4');
        
        // Construir URL do servidor Wowza
        const isProduction = window.location.hostname !== 'localhost';
        const wowzaHost = isProduction ? 'samhost.wcore.com.br' : '51.222.156.223';
        const wowzaUser = 'admin';
        const wowzaPassword = 'FK38Ca2SuE6jvJXed97VMn';
        
        return `http://${wowzaUser}:${wowzaPassword}@${wowzaHost}:6980/content/${userLogin}/${folderName}/${mp4FileName}`;
      }
    }
    
    // Para URLs SSH ou outras, usar como está
    if (url.includes('/api/videos-ssh/') || url.startsWith('http')) {
      return url;
    }
    
    // Fallback: usar proxy do backend
    const cleanPath = url.replace(/^\/+/, '');
    const token = localStorage.getItem('auth_token');
    const baseUrl = `/content/${cleanPath}`;
    return token ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}auth_token=${encodeURIComponent(token)}` : baseUrl;
  };

  const buildMP4Url = (video: Video) => {
    if (!video.url) return '';
    
    const userLogin = user?.email?.split('@')[0] || 'usuario';
    
    // Extrair informações do caminho do vídeo
    const cleanPath = video.url.replace(/^\/+/, '');
    const pathParts = cleanPath.split('/');
    
    if (pathParts.length >= 3) {
      const folderName = pathParts[pathParts.length - 2];
      const fileName = pathParts[pathParts.length - 1];
      const mp4FileName = fileName.endsWith('.mp4') ? fileName : fileName.replace(/\.[^/.]+$/, '.mp4');
      
      // Construir URL direta do Wowza
      const isProduction = window.location.hostname !== 'localhost';
      const wowzaHost = isProduction ? 'samhost.wcore.com.br' : '51.222.156.223';
      const wowzaUser = 'admin';
      const wowzaPassword = 'FK38Ca2SuE6jvJXed97VMn';
      
      return `http://${wowzaUser}:${wowzaPassword}@${wowzaHost}:6980/content/${userLogin}/${folderName}/${mp4FileName}`;
    }
    
    return buildVideoUrl(video.url);
  };

  const openVideoInNewTab = (video: Video) => {
    const mp4Url = buildMP4Url(video);
    window.open(mp4Url, '_blank');
  };

  const syncFolder = async (folderId: number) => {
    setLoading(true);
    try {
      const token = await getToken();
      const response = await fetch('/api/videos-ssh/sync-database', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ folderId })
      });

      if (response.ok) {
        const result = await response.json();
        toast.success(result.message || 'Sincronização concluída!');
        await loadVideosForFolder(folderId);
        await loadFolderUsage(folderId);
      } else {
        const errorData = await response.json();
        toast.error(errorData.error || 'Erro na sincronização');
      }
    } catch (error) {
      console.error('Erro na sincronização:', error);
      toast.error('Erro na sincronização com servidor');
    } finally {
      setLoading(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  };

  const formatDuration = (seconds: number): string => {
    if (!seconds) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center mb-6">
        <Link to="/dashboard" className="flex items-center text-primary-600 hover:text-primary-800">
          <ChevronLeft className="h-5 w-5 mr-1" />
          <span>Voltar ao Dashboard</span>
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Upload className="h-8 w-8 text-primary-600" />
          <h1 className="text-3xl font-bold text-gray-900">Gerenciar Vídeos</h1>
        </div>
        
        <button
          onClick={() => setShowNewFolderModal(true)}
          className="bg-primary-600 text-white px-4 py-2 rounded-md hover:bg-primary-700 flex items-center"
        >
          <FolderPlus className="h-4 w-4 mr-2" />
          Nova Pasta
        </button>
      </div>

      {/* Lista de Pastas e Vídeos */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        {folders.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Folder className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p className="text-lg mb-2">Nenhuma pasta criada</p>
            <p className="text-sm">Crie uma pasta para organizar seus vídeos</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {folders.map((folder) => {
              const isExpanded = expandedFolders[folder.id];
              const videos = videosByFolder[folder.id] || [];
              const usage = folderUsages[folder.id];

              return (
                <div key={folder.id}>
                  {/* Cabeçalho da Pasta */}
                  <div className="p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center justify-between">
                      {editingFolder?.id === folder.id ? (
                        <div className="flex items-center space-x-3 flex-1">
                          <Folder className="h-6 w-6 text-blue-600" />
                          <div className="flex-1">
                            <div className="flex items-center space-x-2">
                              <input
                                type="text"
                                value={newFolderName}
                                onChange={(e) => setNewFolderName(e.target.value)}
                                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-primary-500 focus:border-primary-500"
                                onKeyPress={(e) => {
                                  if (e.key === 'Enter') {
                                    saveFolderName();
                                  } else if (e.key === 'Escape') {
                                    cancelFolderEdit();
                                  }
                                }}
                                autoFocus
                              />
                              <button
                                onClick={saveFolderName}
                                className="text-green-600 hover:text-green-800 p-2"
                                title="Salvar"
                              >
                                <Save className="h-4 w-4" />
                              </button>
                              <button
                                onClick={cancelFolderEdit}
                                className="text-gray-600 hover:text-gray-800 p-2"
                                title="Cancelar"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                            <div className="flex items-center space-x-4 text-sm text-gray-500 mt-1">
                              <span>{videos.length} vídeo(s)</span>
                              {usage && (
                                <>
                                  <span>•</span>
                                  <span>{usage.used}MB / {usage.total}MB</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div 
                          className="flex items-center space-x-3 cursor-pointer flex-1"
                          onClick={() => toggleFolder(folder.id)}
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-5 w-5 text-gray-600" />
                          ) : (
                            <ChevronRight className="h-5 w-5 text-gray-600" />
                          )}
                          <Folder className="h-6 w-6 text-blue-600" />
                          <div className="flex-1">
                            <h3 className="text-lg font-semibold text-gray-900">{folder.nome}</h3>
                            <div className="flex items-center space-x-4 text-sm text-gray-500">
                              <span>{videos.length} vídeo(s)</span>
                              {usage && (
                                <>
                                  <span>•</span>
                                  <span>{usage.used}MB / {usage.total}MB</span>
                                  <div className="flex items-center space-x-2">
                                    <div className="w-16 bg-gray-200 rounded-full h-1.5">
                                      <div
                                        className={`h-1.5 rounded-full transition-all duration-300 ${
                                          usage.percentage > 90 ? 'bg-red-600' :
                                          usage.percentage > 70 ? 'bg-yellow-600' :
                                          'bg-green-600'
                                        }`}
                                        style={{ width: `${Math.min(100, usage.percentage)}%` }}
                                      ></div>
                                    </div>
                                    <span className={`text-xs font-medium ${
                                      usage.percentage > 90 ? 'text-red-600' :
                                      usage.percentage > 70 ? 'text-yellow-600' :
                                      'text-green-600'
                                    }`}>
                                      {usage.percentage}%
                                    </span>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {editingFolder?.id !== folder.id && (
                        <div className="flex items-center space-x-2">
                          <label className="bg-primary-600 text-white px-3 py-2 rounded-md hover:bg-primary-700 cursor-pointer flex items-center text-sm">
                            <Upload className="h-4 w-4 mr-2" />
                            {uploading ? 'Enviando...' : 'Enviar'}
                            <input
                              type="file"
                              accept="video/*,.mp4,.avi,.mov,.wmv,.flv,.webm,.mkv,.3gp,.3g2,.ts,.mpg,.mpeg,.ogv,.m4v,.asf"
                              onChange={(e) => handleFileUpload(e, folder.id)}
                              className="hidden"
                              disabled={uploading}
                            />
                          </label>
                          
                          <button
                            onClick={() => syncFolder(folder.id)}
                            disabled={loading}
                            className="bg-gray-600 text-white px-3 py-2 rounded-md hover:bg-gray-700 disabled:opacity-50 flex items-center text-sm"
                            title="Sincronizar com servidor"
                          >
                            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                          </button>
                          
                          <button
                            onClick={() => handleEditFolder(folder)}
                            className="bg-orange-600 text-white px-3 py-2 rounded-md hover:bg-orange-700 flex items-center text-sm"
                            title="Editar pasta"
                          >
                            <FolderEdit className="h-4 w-4" />
                          </button>
                          
                          <button
                            onClick={() => confirmDeleteFolder(folder)}
                            className="bg-red-600 text-white px-3 py-2 rounded-md hover:bg-red-700 flex items-center text-sm"
                            title="Excluir pasta"
                          >
                            <FolderX className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Lista de Vídeos (expandível) */}
                  {isExpanded && (
                    <div className="bg-gray-50 border-t border-gray-200">
                      {videos.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                          <Video className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                          <p className="text-sm">Nenhum vídeo nesta pasta</p>
                          <p className="text-xs">Use o botão "Enviar" para adicionar vídeos</p>
                        </div>
                      ) : (
                        <div className="divide-y divide-gray-200">
                          {videos.map((video) => (
                            <div key={video.id} className="p-4 hover:bg-gray-100 transition-colors">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-4 flex-1">
                                  {/* Thumbnail simples */}
                                  <div className="w-20 h-12 bg-gray-200 rounded overflow-hidden flex-shrink-0 flex items-center justify-center">
                                    <Video className="h-6 w-6 text-gray-400" />
                                  </div>
                                  
                                  {/* Informações do vídeo */}
                                  <div className="flex-1 min-w-0">
                                    {editingVideo?.id === video.id ? (
                                      <div className="flex items-center space-x-2">
                                        <input
                                          type="text"
                                          value={newVideoName}
                                          onChange={(e) => setNewVideoName(e.target.value)}
                                          className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-primary-500 focus:border-primary-500"
                                          onKeyPress={(e) => {
                                            if (e.key === 'Enter') {
                                              saveVideoName();
                                            } else if (e.key === 'Escape') {
                                              cancelEdit();
                                            }
                                          }}
                                          autoFocus
                                        />
                                        <button
                                          onClick={saveVideoName}
                                          className="text-green-600 hover:text-green-800 p-2"
                                          title="Salvar"
                                        >
                                          <Save className="h-4 w-4" />
                                        </button>
                                        <button
                                          onClick={cancelEdit}
                                          className="text-gray-600 hover:text-gray-800 p-2"
                                          title="Cancelar"
                                        >
                                          <X className="h-4 w-4" />
                                        </button>
                                      </div>
                                    ) : (
                                      <>
                                        <h4 className="font-medium text-gray-900 truncate" title={video.nome}>
                                          {video.nome}
                                        </h4>
                                        <div className="flex items-center space-x-4 text-sm text-gray-600 mt-1 flex-wrap">
                                          {video.duracao && (
                                            <span>⏱️ {formatDuration(video.duracao)}</span>
                                          )}
                                          {video.tamanho && (
                                            <span>💾 {formatFileSize(video.tamanho)}</span>
                                          )}
                                          {video.bitrate_video && (
                                            <div className="flex items-center space-x-1">
                                              <Zap className="h-3 w-3" />
                                              <span className={`font-medium ${
                                                video.bitrate_exceeds_limit ? 'text-red-600' : 'text-gray-600'
                                              }`}>
                                                {video.bitrate_video} kbps
                                              </span>
                                              {video.bitrate_exceeds_limit && (
                                                <span className="text-xs bg-red-100 text-red-800 px-1.5 py-0.5 rounded">
                                                  EXCEDE LIMITE
                                                </span>
                                              )}
                                            </div>
                                          )}
                                          {video.formato_original && (
                                            <span className={`text-xs px-2 py-1 rounded ${
                                              video.is_mp4 ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                                            }`}>
                                              {video.formato_original.toUpperCase()}
                                            </span>
                                          )}
                                        </div>
                                        
                                        {/* Aviso de conversão necessária */}
                                        {video.bitrate_exceeds_limit && (
                                          <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded-md">
                                            <div className="flex items-center text-xs text-red-800">
                                              <AlertCircle className="h-3 w-3 mr-1" />
                                              <span>
                                                Bitrate {video.bitrate_video} kbps excede o limite do plano ({video.user_bitrate_limit} kbps).
                                              </span>
                                            </div>
                                            <Link 
                                              to="/dashboard/conversao-videos"
                                              className="text-xs text-red-700 hover:text-red-900 underline mt-1 inline-flex items-center"
                                            >
                                              <Settings className="h-3 w-3 mr-1" />
                                              Converter vídeo
                                            </Link>
                                          </div>
                                        )}
                                      </>
                                    )}
                                  </div>
                                </div>

                                {/* Ações do vídeo */}
                                {editingVideo?.id !== video.id && (
                                  <div className="flex items-center space-x-1">
                                    <button
                                      onClick={() => openVideoPlayer(video)}
                                      className="text-primary-600 hover:text-primary-800 p-2 rounded-md hover:bg-primary-50 transition-colors"
                                      title="Reproduzir no player"
                                    >
                                      <Play className="h-4 w-4" />
                                    </button>
                                    
                                    <button
                                      onClick={() => openVideoInNewTab(video)}
                                      className="text-blue-600 hover:text-blue-800 p-2 rounded-md hover:bg-blue-50 transition-colors"
                                      title="Visualizar em nova aba"
                                    >
                                      <ExternalLink className="h-4 w-4" />
                                    </button>
                                    
                                    {video.bitrate_exceeds_limit && (
                                      <Link
                                        to="/dashboard/conversao-videos"
                                        className="text-orange-600 hover:text-orange-800 p-2 rounded-md hover:bg-orange-50 transition-colors"
                                        title="Converter vídeo"
                                      >
                                        <Settings className="h-4 w-4" />
                                      </Link>
                                    )}
                                    
                                    <button
                                      onClick={() => handleEditVideo(video)}
                                      className="text-orange-600 hover:text-orange-800 p-2 rounded-md hover:bg-orange-50 transition-colors"
                                      title="Editar nome"
                                    >
                                      <Edit2 className="h-4 w-4" />
                                    </button>
                                    
                                    <button
                                      onClick={() => openVideoInNewTab(video)}
                                      className="text-green-600 hover:text-green-800 p-2 rounded-md hover:bg-green-50 transition-colors"
                                      title="Abrir vídeo em nova aba"
                                    >
                                      <ExternalLink className="h-4 w-4" />
                                    </button>
                                    
                                    <button
                                      onClick={() => handleDeleteVideo(video.id, video.nome, folder.id)}
                                      className="text-red-600 hover:text-red-800 p-2 rounded-md hover:bg-red-50 transition-colors"
                                      title="Excluir"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal de Nova Pasta */}
      {showNewFolderModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full">
            <div className="p-6 border-b border-gray-200">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">Nova Pasta</h3>
                <button
                  onClick={() => setShowNewFolderModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="p-6">
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Nome da Pasta
                </label>
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                  placeholder="Digite o nome da pasta"
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      handleCreateFolder();
                    }
                  }}
                />
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setShowNewFolderModal(false)}
                  className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleCreateFolder}
                  disabled={!newFolderName.trim()}
                  className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
                >
                  Criar Pasta
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmação para Excluir Pasta */}
      {showDeleteFolderModal && folderToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full">
            <div className="p-6 border-b border-gray-200">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold text-red-600">Confirmar Exclusão</h3>
                <button
                  onClick={() => setShowDeleteFolderModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="p-6">
              <div className="flex items-start space-x-3">
                <AlertCircle className="h-6 w-6 text-red-600 mt-1" />
                <div>
                  <h4 className="text-lg font-medium text-gray-900 mb-2">
                    Excluir pasta "{folderToDelete.nome}"?
                  </h4>
                  <p className="text-gray-600 mb-4">
                    Esta ação irá excluir a pasta e todos os vídeos dentro dela, tanto do banco de dados quanto do servidor Wowza.
                  </p>
                  <div className="bg-red-50 border border-red-200 rounded-md p-3">
                    <p className="text-red-800 text-sm font-medium">
                      ⚠️ Esta ação não pode ser desfeita!
                    </p>
                    <p className="text-red-700 text-sm mt-1">
                      Todos os vídeos da pasta serão permanentemente removidos do servidor.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-3 mt-6">
                <button
                  onClick={() => setShowDeleteFolderModal(false)}
                  className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleDeleteFolder}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                >
                  Confirmar Exclusão
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Progresso de Upload */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full">
            <div className="p-6 border-b border-gray-200">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">Enviando Vídeo</h3>
                {uploadProgress[0]?.status === 'completed' && (
                  <button
                    onClick={() => {
                      setShowUploadModal(false);
                      setUploadProgress([]);
                    }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-5 w-5" />
                  </button>
                )}
              </div>
            </div>

            <div className="p-6">
              {uploadProgress.map((progress, index) => (
                <div key={index} className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {progress.fileName}
                      </p>
                      <div className="flex items-center space-x-2 text-xs text-gray-500 mt-1">
                        {progress.size && (
                          <span>Tamanho: {formatFileSize(progress.size)}</span>
                        )}
                        {progress.uploadedSize && progress.size && (
                          <span>• Enviado: {formatFileSize(progress.uploadedSize)}</span>
                        )}
                      </div>
                    </div>
                    <div className="ml-4 flex items-center">
                      {progress.status === 'uploading' && (
                        <Upload className="h-4 w-4 text-blue-600 animate-pulse" />
                      )}
                      {progress.status === 'processing' && (
                        <RefreshCw className="h-4 w-4 text-yellow-600 animate-spin" />
                      )}
                      {progress.status === 'completed' && (
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      )}
                      {progress.status === 'error' && (
                        <AlertCircle className="h-4 w-4 text-red-600" />
                      )}
                    </div>
                  </div>

                  {/* Barra de progresso */}
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all duration-300 ${
                        progress.status === 'completed' ? 'bg-green-600' :
                        progress.status === 'error' ? 'bg-red-600' :
                        progress.status === 'processing' ? 'bg-yellow-600' :
                        'bg-blue-600'
                      }`}
                      style={{ width: `${progress.progress}%` }}
                    ></div>
                  </div>

                  {/* Status text */}
                  <div className="flex items-center justify-between text-sm">
                    <span className={`font-medium ${
                      progress.status === 'completed' ? 'text-green-600' :
                      progress.status === 'error' ? 'text-red-600' :
                      progress.status === 'processing' ? 'text-yellow-600' :
                      'text-blue-600'
                    }`}>
                      {progress.status === 'uploading' ? 'Enviando...' :
                       progress.status === 'processing' ? 'Processando no servidor...' :
                       progress.status === 'completed' ? 'Upload concluído!' :
                       'Erro no upload'}
                    </span>
                    <span className="text-gray-500">
                      {progress.progress}%
                    </span>
                  </div>

                  {/* Erro details */}
                  {progress.status === 'error' && progress.error && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                      <p className="text-red-800 text-sm">{progress.error}</p>
                    </div>
                  )}

                  {/* Success details */}
                  {progress.status === 'completed' && (
                    <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                      <p className="text-green-800 text-sm">
                        ✅ Vídeo enviado com sucesso para o servidor!
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal do Player Simples */}
      {showPlayerModal && currentVideo && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-95 flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              closeVideoPlayer();
            }
          }}
        >
          <div className="bg-black rounded-lg relative max-w-4xl w-full h-[70vh]">
            {/* Controles do Modal */}
            <div className="absolute top-4 right-4 z-20 flex items-center space-x-2">
              <button
                onClick={closeVideoPlayer}
                className="text-white bg-red-600 hover:bg-red-700 rounded-full p-3 transition-colors duration-200 shadow-lg"
                title="Fechar player"
              >
                <X size={20} />
              </button>
            </div>

            {/* Título do Vídeo */}
            <div className="absolute top-4 left-4 z-20 bg-black bg-opacity-60 text-white px-4 py-2 rounded-lg">
              <h3 className="font-medium">{currentVideo.nome}</h3>
              <p className="text-xs opacity-80">
                {currentVideo.duracao ? formatDuration(currentVideo.duracao) : ''} • 
                {currentVideo.tamanho ? formatFileSize(currentVideo.tamanho) : ''}
              </p>
            </div>

            {/* Player HTML5 Simples */}
            <div className="w-full h-full p-4 pt-16">
              <video
                src={buildVideoUrl(currentVideo.url)}
                className="w-full h-full object-contain"
                controls
                autoPlay
                preload="metadata"
                onError={(e) => {
                  console.error('Erro no player:', e);
                  toast.error('Erro ao carregar vídeo. Tente abrir em nova aba.');
                }}
              >
                <source src={buildVideoUrl(currentVideo.url)} type="video/mp4" />
                <source src={buildVideoUrl(currentVideo.url)} type="application/vnd.apple.mpegurl" />
                Seu navegador não suporta reprodução de vídeo.
              </video>
            </div>
          </div>
        </div>
      )}

      {/* Informações de Ajuda */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <div className="flex items-start">
          <AlertCircle className="h-5 w-5 text-blue-600 mr-3 mt-0.5" />
          <div>
            <h3 className="text-blue-900 font-medium mb-2">Como usar</h3>
            <ul className="text-blue-800 text-sm space-y-1">
              <li>• Clique na seta ao lado da pasta para expandir e ver os vídeos</li>
              <li>• Use os botões de ação para reproduzir, editar, visualizar ou excluir vídeos</li>
              <li>• Envie vídeos nos formatos: MP4, AVI, MOV, WMV, FLV, WebM, MKV, etc.</li>
              <li>• <strong>IMPORTANTE:</strong> Apenas vídeos MP4 podem ser reproduzidos diretamente</li>
              <li>• <strong>Vídeos não-MP4:</strong> Aparecem em vermelho e precisam ser convertidos</li>
              <li>• Use "Sincronizar" para atualizar a lista com vídeos enviados via FTP</li>
              <li>• Monitore o uso de espaço para não exceder seu plano</li>
              <li>• <strong>Bitrate:</strong> Vídeos com bitrate acima do seu plano aparecerão em vermelho</li>
              <li>• <strong>Conversão:</strong> Use a página "Conversão de Vídeos" para ajustar vídeos incompatíveis</li>
              <li>• <strong>Progresso:</strong> Acompanhe o progresso de upload em tempo real</li>
              <li>• <strong>Formatos suportados para reprodução:</strong> Apenas MP4</li>
              <li>• <strong>Formatos aceitos para upload:</strong> MP4, AVI, MOV, WMV, FLV, WebM, MKV, etc.</li>
              <li>• <strong>Indicadores visuais:</strong></li>
              <li>&nbsp;&nbsp;- 🟢 Verde: MP4 compatível e dentro do limite de bitrate</li>
              <li>&nbsp;&nbsp;- 🔴 Vermelho: Formato não-MP4 OU bitrate acima do limite</li>
              <li>&nbsp;&nbsp;- ⚠️ Botões desabilitados: Para vídeos que não podem ser reproduzidos</li>
              <li>• <strong>Gerenciamento de pastas:</strong> Use os botões laranja e vermelho para editar ou excluir pastas</li>
              <li>• <strong>ATENÇÃO:</strong> Excluir uma pasta remove todos os vídeos do servidor Wowza permanentemente</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GerenciarVideos;